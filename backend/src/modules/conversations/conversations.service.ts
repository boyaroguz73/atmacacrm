import { Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  OrgSessionScopeUser,
  whereConversationsForOrg,
} from '../../common/org-session-scope';
import { WahaService } from '../waha/waha.service';
import { ContactsService } from '../contacts/contacts.service';
import {
  canonicalContactPhone,
  contactPhoneLookupKeys,
  extractPhoneFromIndividualJid,
  formatPhoneDisplay,
  isFallbackContactName,
  isLikelyLidPhone,
  isValidPhoneNumber,
} from '../../common/contact-phone';
import { Prisma } from '@prisma/client';

function isWeakGroupLabel(name: string | null | undefined): boolean {
  const t = (name ?? '').trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  return lower === 'grup' || lower === 'whatsapp grubu';
}

function normalizeSearchText(v: string | null | undefined): string {
  return (v || '').toLocaleLowerCase('tr-TR').trim();
}

function searchNeedles(rawSearch: string): { rawNeedles: string[]; digitNeedles: string[] } {
  const raw = rawSearch.trim();
  const digits = raw.replace(/\D/g, '');
  const rawSet = new Set<string>();
  const digitSet = new Set<string>();
  if (raw) rawSet.add(raw);
  if (digits) {
    digitSet.add(digits);
    const withoutLeadingZeros = digits.replace(/^0+/, '');
    if (withoutLeadingZeros && withoutLeadingZeros !== digits) digitSet.add(withoutLeadingZeros);
  }
  return { rawNeedles: Array.from(rawSet), digitNeedles: Array.from(digitSet) };
}

function scoreConversationMatch(conv: any, rawNeedles: string[], digitNeedles: string[]): number {
  const name = normalizeSearchText(conv?.contact?.name);
  const surname = normalizeSearchText(conv?.contact?.surname);
  const fullName = `${name} ${surname}`.trim();
  const phone = String(conv?.contact?.phone || '');
  const phoneDigits = phone.replace(/\D/g, '');
  let score = 0;

  for (const needle of rawNeedles.map((n) => normalizeSearchText(n)).filter(Boolean)) {
    if (fullName === needle || name === needle || surname === needle) score += 1000;
    else if (fullName.startsWith(needle) || name.startsWith(needle) || surname.startsWith(needle)) score += 700;
    else if (fullName.includes(needle) || name.includes(needle) || surname.includes(needle)) score += 350;
  }

  for (const needle of digitNeedles.filter(Boolean)) {
    if (phoneDigits === needle) score += 1400;
    else if (phoneDigits.endsWith(needle)) score += 1100;
    else if (phoneDigits.startsWith(needle)) score += 800;
    else if (phoneDigits.includes(needle)) score += 450;
  }

  return score;
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => WahaService))
    private readonly wahaService: WahaService,
    private readonly contactsService: ContactsService,
  ) {}

  async findOrCreate(contactId: string, sessionId: string) {
    try {
      return await this.prisma.conversation.create({
        data: { contactId, sessionId },
      });
    } catch (e: any) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existing = await this.prisma.conversation.findUnique({
          where: { contactId_sessionId: { contactId, sessionId } },
        });
        if (existing) return existing;
      }
      throw e;
    }
  }

  /**
   * WhatsApp grubu için conversation oluştur/bul.
   * Gruplar için isGroup=true ve waGroupId alanları kullanılır.
   */
  async findOrCreateGroup(
    contactId: string,
    sessionId: string,
    waGroupId: string,
    groupName?: string,
  ) {
    // Önce waGroupId ile ara (eğer unique constraint varsa)
    const existing = await this.prisma.conversation.findFirst({
      where: {
        waGroupId: waGroupId.toLowerCase(),
        sessionId,
      },
    });

    if (existing) {
      const contactRow = await this.prisma.contact.findUnique({
        where: { id: contactId },
        select: { name: true },
      });
      const fromPayload =
        groupName && !isWeakGroupLabel(groupName) ? groupName.trim() : null;
      const fromContact =
        contactRow?.name && !isWeakGroupLabel(contactRow.name)
          ? contactRow.name.trim()
          : null;
      const resolvedName = fromPayload || fromContact || 'WhatsApp Grubu';

      if (resolvedName && existing.groupName !== resolvedName) {
        const updated = await this.prisma.conversation.update({
          where: { id: existing.id },
          data: { groupName: resolvedName },
        });
        if (contactRow && contactRow.name !== resolvedName) {
          await this.prisma.contact
            .update({
              where: { id: contactId },
              data: { name: resolvedName },
            })
            .catch(() => {});
        }
        return updated;
      }
      return existing;
    }

    const contactRow = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { name: true },
    });
    const fromPayload =
      groupName && !isWeakGroupLabel(groupName) ? groupName.trim() : null;
    const fromContact =
      contactRow?.name && !isWeakGroupLabel(contactRow.name)
        ? contactRow.name.trim()
        : null;
    const initialName = fromPayload || fromContact || 'WhatsApp Grubu';

    // Yeni grup conversation oluştur
    try {
      return await this.prisma.conversation.create({
        data: {
          contactId,
          sessionId,
          isGroup: true,
          waGroupId: waGroupId.toLowerCase(),
          groupName: initialName,
        },
      });
    } catch (e: any) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existingByComposite = await this.prisma.conversation.findUnique({
          where: { contactId_sessionId: { contactId, sessionId } },
        });
        if (existingByComposite) return existingByComposite;
      }
      throw e;
    }
  }

  async findAll(
    user: OrgSessionScopeUser,
    params: {
      sessionId?: string;
      assignedTo?: string;
      isArchived?: boolean;
      search?: string;
      filter?: string;
      isGroup?: boolean;
      page?: number;
      limit?: number;
    },
  ) {
    const {
      sessionId,
      assignedTo,
      isArchived = false,
      search,
      filter,
      isGroup,
      page = 1,
      limit = 500,
    } = params;

    const whereExtras: any = { isArchived };

    if (sessionId) whereExtras.sessionId = sessionId;
    if (typeof isGroup === 'boolean') whereExtras.isGroup = isGroup;

    if (filter === 'all') {
      // Yalnızca org kapsamı; atama filtresi yok (temsilci "tüm sohbetler")
    } else if (filter === 'mine' && assignedTo) {
      whereExtras.assignments = {
        some: { userId: assignedTo, unassignedAt: null },
      };
    } else if (filter === 'mine_and_unassigned' && assignedTo) {
      whereExtras.OR = [
        { assignments: { none: { unassignedAt: null } } },
        { assignments: { some: { userId: assignedTo, unassignedAt: null } } },
      ];
    } else if (filter === 'unassigned') {
      whereExtras.assignments = { none: { unassignedAt: null } };
    } else if (filter === 'unanswered') {
      whereExtras.messages = {
        every: { direction: 'INCOMING' },
      };
      whereExtras.unreadCount = { gt: 0 };
    } else if (filter === 'answered') {
      whereExtras.messages = {
        some: { direction: 'OUTGOING' },
      };
    } else if (filter === 'followup') {
      whereExtras.contact = {
        ...whereExtras.contact,
        tasks: { some: { status: 'PENDING' } },
      };
    } else if (assignedTo) {
      whereExtras.assignments = {
        some: { userId: assignedTo, unassignedAt: null },
      };
    }

    const trimmedSearch = (search || '').trim();
    if (trimmedSearch) {
      const { rawNeedles, digitNeedles } = searchNeedles(trimmedSearch);
      const searchConditions = [
        ...rawNeedles.map((needle) => ({ name: { contains: needle, mode: 'insensitive' as const } })),
        ...rawNeedles.map((needle) => ({ surname: { contains: needle, mode: 'insensitive' as const } })),
        ...rawNeedles.map((needle) => ({ phone: { contains: needle } })),
        ...digitNeedles.map((needle) => ({ phone: { contains: needle } })),
      ];
      if (whereExtras.contact) {
        whereExtras.contact = { ...whereExtras.contact, OR: searchConditions };
      } else {
        whereExtras.contact = { OR: searchConditions };
      }
    }

    // WhatsApp kanallarını filtrele (newsletter ve broadcast)
    // Gruplar (@g.us) ve bireysel sohbetler (@c.us) görünür
    const channelFilter = {
      contact: {
        ...whereExtras.contact,
        NOT: {
          OR: [
            { phone: { contains: '@newsletter' } },
            { phone: { contains: '@broadcast' } },
          ],
        },
      },
    };
    if (whereExtras.contact) {
      whereExtras.contact = channelFilter.contact;
    } else {
      whereExtras.contact = channelFilter.contact;
    }

    const where = whereConversationsForOrg(user, whereExtras);

    const include = {
      contact: { include: { lead: true } },
      session: { select: { id: true, name: true, phone: true, organizationId: true } },
      messages: {
        orderBy: { timestamp: 'desc' as const },
        take: 1,
        select: { direction: true },
      },
      assignments: {
        where: { unassignedAt: null },
        include: {
          user: { select: { id: true, name: true, avatar: true } },
        },
      },
    };

    const totalPromise = this.prisma.conversation.count({ where });
    let conversations: any[] = [];
    let total = 0;

    if (trimmedSearch) {
      const fetchCap = Math.min(2000, Math.max(limit * 8, 500));
      const [allMatched, counted] = await Promise.all([
        this.prisma.conversation.findMany({
          where,
          include,
          orderBy: { lastMessageAt: 'desc' },
          take: fetchCap,
        }),
        totalPromise,
      ]);
      const { rawNeedles, digitNeedles } = searchNeedles(trimmedSearch);
      const ranked = [...allMatched].sort((a, b) => {
        const scoreDiff =
          scoreConversationMatch(b, rawNeedles, digitNeedles) -
          scoreConversationMatch(a, rawNeedles, digitNeedles);
        if (scoreDiff !== 0) return scoreDiff;
        return (
          new Date(b.lastMessageAt || 0).getTime() -
          new Date(a.lastMessageAt || 0).getTime()
        );
      });
      conversations = ranked.slice((page - 1) * limit, page * limit);
      total = counted;
    } else {
      [conversations, total] = await Promise.all([
        this.prisma.conversation.findMany({
          where,
          include,
          orderBy: { lastMessageAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        totalPromise,
      ]);
    }

    // Liste açılışında "WhatsApp Grubu" gibi zayıf başlıklar kalmasın:
    // sınırlı sayıda zayıf grubu WAHA'dan subject ile iyileştir.
    const weakGroups = conversations
      .filter(
        (c: any) =>
          c?.isGroup &&
          c?.waGroupId &&
          c?.session?.name &&
          isWeakGroupLabel(c?.groupName),
      )
      .slice(0, 12);
    if (weakGroups.length > 0) {
      await Promise.all(
        weakGroups.map(async (c: any) => {
          try {
            const meta = await this.wahaService.getGroupById(c.session.name, c.waGroupId);
            const subject =
              (typeof meta?.subject === 'string' && meta.subject.trim()) ||
              (typeof meta?.name === 'string' && meta.name.trim()) ||
              '';
            if (!subject) return;
            c.groupName = subject;
            await this.prisma.conversation
              .update({
                where: { id: c.id },
                data: { groupName: subject },
              })
              .catch(() => {});
            await this.prisma.contact
              .update({
                where: { id: c.contactId },
                data: { name: subject },
              })
              .catch(() => {});
          } catch {
            // sessiz geç: listeyi bozma
          }
        }),
      );
    }

    return {
      conversations: conversations.map((c: any) => ({
        ...c,
        groupName:
          c.isGroup && isWeakGroupLabel(c.groupName)
            ? c.contact?.name || c.groupName
            : c.groupName,
        lastMessageDirection: c.messages?.[0]?.direction ?? null,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Teklif/Sipariş gömülü chat: kişiye ait en uygun görüşme. */
  async findLatestByContactId(
    contactId: string,
    opts?: {
      currentUserId?: string;
      currentUserRole?: string;
      organizationId?: string | null;
      preferAssignedToCurrentAgent?: boolean;
    },
  ) {
    const include = {
      contact: { include: { lead: true } },
      session: { select: { id: true, name: true, phone: true, organizationId: true } },
      assignments: {
        where: { unassignedAt: null },
        include: {
          user: { select: { id: true, name: true, avatar: true } },
        },
      },
    } as const;

    const baseWhere: any = { contactId };
    if (opts?.organizationId && opts.currentUserRole !== 'SUPERADMIN') {
      baseWhere.contact = { organizationId: opts.organizationId };
    }

    const shouldPreferMine =
      opts?.preferAssignedToCurrentAgent !== false &&
      opts?.currentUserRole === 'AGENT' &&
      !!opts?.currentUserId;

    let conv = shouldPreferMine
      ? await this.prisma.conversation.findFirst({
          where: {
            ...baseWhere,
            assignments: {
              some: {
                userId: String(opts?.currentUserId),
                unassignedAt: null,
              },
            },
          },
          include,
          orderBy: { lastMessageAt: 'desc' },
        })
      : null;

    if (!conv) {
      conv = await this.prisma.conversation.findFirst({
        where: baseWhere,
        include,
        orderBy: { lastMessageAt: 'desc' },
      });
    }
    if (
      conv &&
      !conv.isGroup &&
      conv.session?.name &&
      conv.contact?.phone &&
      !conv.contact.phone.startsWith('group:')
    ) {
      await this.enrichDmContactFromWaha(
        conv.contactId,
        conv.session.name,
        conv.contact.organizationId,
      );
      conv = await this.prisma.conversation.findUnique({
        where: { id: conv.id },
        include,
      });
    }
    return conv;
  }

  async findById(
    id: string,
    options?: { skipContactEnrichment?: boolean },
  ) {
    let conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        contact: { include: { lead: true } },
        session: true,
        assignments: {
          where: { unassignedAt: null },
          include: {
            user: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Görüşme bulunamadı');

    let groupMeta: { size?: number } | null = null;
    if (
      conversation.isGroup &&
      conversation.waGroupId &&
      conversation.session?.name &&
      isWeakGroupLabel(conversation.groupName)
    ) {
      const meta = await this.wahaService.getGroupById(
        conversation.session.name,
        conversation.waGroupId,
      );
      groupMeta = meta;
      const subject =
        (typeof meta?.subject === 'string' && meta.subject.trim()) ||
        (typeof meta?.name === 'string' && meta.name.trim()) ||
        '';
      if (subject) {
        conversation = await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { groupName: subject },
          include: {
            contact: { include: { lead: true } },
            session: true,
            assignments: {
              where: { unassignedAt: null },
              include: {
                user: { select: { id: true, name: true, avatar: true } },
              },
            },
          },
        });
        await this.prisma.contact
          .update({
            where: { id: conversation.contactId },
            data: { name: subject },
          })
          .catch(() => {});
      }
    }

    const groupParticipantCount =
      conversation.isGroup &&
      typeof groupMeta?.size === 'number' &&
      groupMeta.size >= 0
        ? groupMeta.size
        : undefined;

    if (
      !options?.skipContactEnrichment &&
      !conversation.isGroup &&
      conversation.session?.name &&
      conversation.contact?.phone &&
      !conversation.contact.phone.startsWith('group:')
    ) {
      try {
        await this.enrichDmContactFromWaha(
          conversation.contactId,
          conversation.session.name,
          conversation.contact.organizationId,
        );
        const refreshed = await this.prisma.conversation.findUnique({
          where: { id: conversation.id },
          include: {
            contact: { include: { lead: true } },
            session: true,
            assignments: {
              where: { unassignedAt: null },
              include: {
                user: { select: { id: true, name: true, avatar: true } },
              },
            },
          },
        });
        if (refreshed) conversation = refreshed;
      } catch (e: any) {
        this.logger.debug(`Kişi zenginleştirme atlandı (${conversation.id}): ${e?.message}`);
      }
    }

    return {
      ...conversation,
      isGroup: conversation.isGroup ?? false,
      groupName: conversation.groupName,
      waGroupId: conversation.waGroupId,
      ...(groupParticipantCount !== undefined
        ? { groupParticipantCount }
        : {}),
    };
  }

  /**
   * Mesaj senkronu / toplu işlemler sonrası tek seferlik çağrı için.
   */
  async enrichConversationContactFromWaha(conversationId: string): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true, session: true },
    });
    if (!conv || conv.isGroup || !conv.session?.name || !conv.contact?.phone) return;
    await this.enrichDmContactFromWaha(
      conv.contactId,
      conv.session.name,
      conv.contact.organizationId,
    );
  }

  /**
   * Bireysel DM: WAHA'dan isim / profil fotoğrafı çekip contact'ı günceller.
   */
  private async enrichDmContactFromWaha(
    contactId: string,
    sessionName: string,
    organizationId: string | null,
  ): Promise<void> {
    const row = await this.prisma.contact.findUnique({ where: { id: contactId } });
    if (!row) return;
    let p = row.phone;
    if (!p || p.startsWith('group:') || p.startsWith('lid:')) return;

    if (isLikelyLidPhone(p)) {
      const resolved = await this.tryResolveLidPhoneToReal(row.id, p, sessionName);
      if (!resolved) return;
      p = resolved;
    }

    const merged = await this.contactsService.findOrCreate(
      p,
      undefined,
      organizationId,
    );
    const waDigits =
      this.contactsService.digitsForWahaProfile(merged.phone) ||
      canonicalContactPhone(merged.phone) ||
      '';
    if (!waDigits) return;

    const effectiveId = merged.id;

    const current = await this.prisma.contact.findUnique({ where: { id: effectiveId } });
    if (!current) return;

    const details = await this.wahaService.getContactDetails(
      sessionName,
      `${waDigits}@c.us`,
    );
    const waPush = (details?.pushname || '').trim();
    const waNameField = (details?.name || '').trim();
    const waNotify = ((details as any)?.notify || '').trim();
    const waVerified = ((details as any)?.verifiedName || '').trim();
    const waShort = (details?.shortName || '').trim();
    const waName = (
      waPush ||
      waNotify ||
      waVerified ||
      waNameField ||
      waShort
    ).trim();
    const phoneFallbackName = formatPhoneDisplay(current.phone || waDigits);

    const shouldReplaceName =
      isFallbackContactName(current.name, current.phone) ||
      // WAHA'da name alanı generic/rehber etiketi olabilir; pushname varsa onu tercih et.
      (!!waPush &&
        !!current.name?.trim() &&
        !!waNameField &&
        current.name.trim() === waNameField &&
        waPush !== waNameField);

    if ((waName || phoneFallbackName) && shouldReplaceName) {
      await this.prisma.contact.update({
        where: { id: effectiveId },
        data: { name: waName || phoneFallbackName || null },
      });
    }

    const afterName = await this.prisma.contact.findUnique({
      where: { id: effectiveId },
      select: { avatarUrl: true },
    });
    if (!afterName?.avatarUrl) {
      const picUrl = await this.wahaService.getProfilePicture(sessionName, waDigits);
      if (picUrl) {
        await this.contactsService.fetchAndSaveProfilePicture(
          effectiveId,
          waDigits,
          picUrl,
        );
      }
    }

    await this.ensureContactDisplayNameFallback(effectiveId);
  }

  /**
   * DB'de LID numarası olarak saklanan telefonu WAHA LID API ile gerçek telefona çevirmeye çalışır.
   * Başarılıysa contact.phone güncellenir ve yeni telefon döner; başarısızsa null.
   */
  private async tryResolveLidPhoneToReal(
    contactId: string,
    lidPhone: string,
    sessionName: string,
  ): Promise<string | null> {
    const lidDigits = String(lidPhone).replace(/\D/g, '');
    if (!lidDigits) return null;

    try {
      const lidJid = `${lidDigits}@lid`;
      const pnJid = await this.wahaService.getLinkedPnFromLid(sessionName, lidJid).catch(() => null);
      let realPhone: string | null = null;
      if (pnJid) {
        realPhone = extractPhoneFromIndividualJid(pnJid);
      }
      if (!realPhone) {
        const details = await this.wahaService.getContactDetails(sessionName, lidJid).catch(() => null);
        const waNumber = details?.number ? String(details.number).replace(/\D/g, '') : '';
        if (waNumber && waNumber !== lidDigits && !isLikelyLidPhone(waNumber)) {
          realPhone = canonicalContactPhone(waNumber);
        }
      }
      if (realPhone && isValidPhoneNumber(realPhone) && !isLikelyLidPhone(realPhone)) {
        try {
          await this.prisma.contact.update({
            where: { id: contactId },
            data: { phone: realPhone },
          });
        } catch (e: any) {
          const existing = await this.prisma.contact.findFirst({
            where: { phone: realPhone },
            select: { id: true },
          });
          if (!existing) throw e;
        }
        this.logger.log(`LID telefon gerçeğe çevrildi: ${lidDigits} → ${realPhone}`);
        return realPhone;
      }
    } catch (e: any) {
      this.logger.debug(`LID çözümleme hatası (${lidDigits}): ${e?.message}`);
    }
    return null;
  }

  /** WA isim yoksa listelerde boş kalmasın: görünen telefon */
  private async ensureContactDisplayNameFallback(contactRowId: string): Promise<void> {
    const row = await this.prisma.contact.findUnique({
      where: { id: contactRowId },
      select: { name: true, surname: true, phone: true },
    });
    if (!row || row.name?.trim() || row.surname?.trim()) return;
    const p = row.phone;
    if (!p || p.startsWith('group:')) return;

    const label = formatPhoneDisplay(p);
    if (label && label !== '—') {
      await this.prisma.contact
        .update({
          where: { id: contactRowId },
          data: { name: label },
        })
        .catch(() => {});
    }
  }

  async markAsRead(id: string) {
    return this.prisma.conversation.update({
      where: { id },
      data: { unreadCount: 0 },
    });
  }

  async archive(id: string) {
    return this.prisma.conversation.update({
      where: { id },
      data: { isArchived: true },
    });
  }

  async assign(conversationId: string, userId: string) {
    await this.prisma.assignment.updateMany({
      where: { conversationId, unassignedAt: null },
      data: { unassignedAt: new Date() },
    });

    return this.prisma.assignment.create({
      data: { conversationId, userId },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });
  }

  async getAssignmentHistory(conversationId: string) {
    return this.prisma.assignment.findMany({
      where: { conversationId },
      orderBy: { assignedAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
      },
      take: 25,
    });
  }

  /**
   * Gelen konuşmayı aktif AGENT'lar arasında round-robin ile atar.
   *
   * Seçim kıstası (en adil dağılım için iki katmanlı):
   *  1) Açık (aktif) konuşma yükü en az olan → iş yükü dengesi.
   *  2) Aynı yükte birden fazla agent varsa, en son bir konuşma atanan
   *     agent değil, en uzun süredir atama almayan agent → klasik
   *     round-robin davranışı.
   *
   * Çoklu organizasyon için `organizationId` verilirse yalnızca o
   * organizasyonun aktif AGENT'ları havuzuna bakılır.
   */
  async autoAssignRoundRobin(conversationId: string, organizationId?: string) {
    // Öncelik: kişiyle ilişkili son T-Soft siparişinin temsilcisi varsa
    // konuşma atamasını ona migrate et. Böylece site siparişi/sepeti kime
    // düştüyse müşteri mesajı da aynı temsilciye gider.
    const tsoftOwnerOrder = await this.prisma.salesOrder.findFirst({
      where: {
        source: 'TSOFT',
        contact: {
          conversations: { some: { id: conversationId } },
          ...(organizationId ? { organizationId } : {}),
        },
        createdBy: {
          role: 'AGENT',
          isActive: true,
          ...(organizationId ? { organizationId } : {}),
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdById: true },
    });
    if (tsoftOwnerOrder?.createdById) {
      return this.assign(conversationId, tsoftOwnerOrder.createdById);
    }

    const agentWhere: any = { role: 'AGENT', isActive: true };
    if (organizationId) agentWhere.organizationId = organizationId;

    const agents = await this.prisma.user.findMany({
      where: agentWhere,
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    if (agents.length === 0) return null;

    const agentIds = agents.map((a) => a.id);

    // 1) Aktif (henüz unassign olmayan) yük sayımı
    const loadRows = await this.prisma.assignment.groupBy({
      by: ['userId'],
      where: { userId: { in: agentIds }, unassignedAt: null },
      _count: { _all: true },
    });
    const loadMap = new Map<string, number>();
    for (const r of loadRows) loadMap.set(r.userId, r._count._all);

    // 2) Round-robin için her agent'in en son atama zamanı
    const lastRows = await this.prisma.assignment.groupBy({
      by: ['userId'],
      where: { userId: { in: agentIds } },
      _max: { assignedAt: true },
    });
    const lastMap = new Map<string, Date | null>();
    for (const r of lastRows) lastMap.set(r.userId, r._max.assignedAt ?? null);

    const scored = agents
      .map((a) => ({
        id: a.id,
        load: loadMap.get(a.id) ?? 0,
        // Hiç atanmamışsa en önce sırada olsun
        last: (lastMap.get(a.id) ?? new Date(0)).getTime(),
      }))
      .sort((x, y) => x.load - y.load || x.last - y.last);

    return this.assign(conversationId, scored[0].id);
  }

  async updateLastMessage(id: string, text: string, timestamp?: Date) {
    return this.prisma.conversation.update({
      where: { id },
      data: { lastMessageText: text, lastMessageAt: timestamp || new Date() },
    });
  }

  async incrementUnread(id: string) {
    return this.prisma.conversation.update({
      where: { id },
      data: { unreadCount: { increment: 1 } },
    });
  }

  async addInternalNote(
    conversationId: string,
    userId: string,
    body: string,
  ) {
    return this.prisma.internalNote.create({
      data: { conversationId, userId, body },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async getHistory(
    user: OrgSessionScopeUser,
    params: {
      search?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, from, to, page = 1, limit = 100 } = params;
    const whereExtras: any = {};

    if (from || to) {
      whereExtras.lastMessageAt = {};
      if (from) whereExtras.lastMessageAt.gte = new Date(from);
      if (to) whereExtras.lastMessageAt.lte = new Date(to);
    }

    if (search) {
      whereExtras.contact = {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { surname: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search } },
        ],
      };
    }

    const where = whereConversationsForOrg(user, whereExtras);

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: {
          contact: {
            select: {
              id: true,
              phone: true,
              name: true,
              surname: true,
            },
          },
          session: { select: { id: true, name: true } },
          assignments: {
            where: { unassignedAt: null },
            include: {
              user: { select: { id: true, name: true } },
            },
          },
          _count: { select: { messages: true } },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return {
      conversations: conversations.map((c) => ({
        ...c,
        messageCount: c._count.messages,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getInternalNotes(conversationId: string) {
    return this.prisma.internalNote.findMany({
      where: { conversationId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async updateInternalNote(noteId: string, body: string) {
    return this.prisma.internalNote.update({
      where: { id: noteId },
      data: { body },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async deleteInternalNote(noteId: string) {
    return this.prisma.internalNote.delete({
      where: { id: noteId },
    });
  }

  async getGroupParticipants(conversationId: string) {
    const conversation = await this.findById(conversationId, { skipContactEnrichment: true });
    if (!conversation.isGroup || !conversation.waGroupId) {
      throw new NotFoundException('Grup konuşması bulunamadı');
    }

    const participants = await this.wahaService.getGroupParticipantsV2(
      conversation.session.name,
      conversation.waGroupId,
    );

    const normalized = await Promise.all(
      participants.map(async (p) => {
        const jid = String(p.id || '');
        let phone = extractPhoneFromIndividualJid(jid) || '';
        if (!phone && /@lid$/i.test(jid)) {
          const pnJid = await this.wahaService
            .getLinkedPnFromLid(conversation.session.name, jid)
            .catch(() => null);
          phone = pnJid ? extractPhoneFromIndividualJid(pnJid) || '' : '';
          if (!phone) {
            const details = await this.wahaService
              .getContactDetails(conversation.session.name, jid)
              .catch(() => null);
            const waNumber = details?.number
              ? String(details.number).replace(/\D/g, '')
              : '';
            if (waNumber && !isLikelyLidPhone(waNumber)) {
              phone = canonicalContactPhone(waNumber);
            }
          }
        }
        if (!phone) {
          const fallback = canonicalContactPhone(jid) || '';
          phone = isLikelyLidPhone(fallback) ? '' : fallback;
        }
        return { jid, phone, role: p.role || 'member' };
      }),
    );

    const allLookupKeys = Array.from(
      new Set(
        normalized
          .flatMap((p) => (p.phone ? contactPhoneLookupKeys(p.phone) : []))
          .filter(Boolean),
      ),
    );
    const matchedContacts = allLookupKeys.length
      ? await this.prisma.contact.findMany({
          where: { phone: { in: allLookupKeys } },
          select: { id: true, phone: true, name: true, surname: true },
        })
      : [];
    const byPhone = new Map<string, { id: string; name: string | null; surname: string | null }>();
    for (const c of matchedContacts) {
      for (const key of contactPhoneLookupKeys(c.phone || '')) {
        byPhone.set(key, { id: c.id, name: c.name, surname: c.surname });
      }
    }

    return normalized.map((p) => {
      const matched = p.phone ? byPhone.get(p.phone) : undefined;
      const displayName = matched
        ? [matched.name, matched.surname].filter(Boolean).join(' ').trim()
        : null;
      return {
        jid: p.jid,
        phone: p.phone || null,
        role: p.role,
        contactId: matched?.id || null,
        name: displayName || null,
      };
    });
  }
}
