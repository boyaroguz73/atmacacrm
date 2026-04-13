import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // 1. SuperAdmin (SaaS Platform Yöneticisi - hiçbir organizasyona bağlı değil)
  const superExisting = await prisma.user.findUnique({
    where: { email: 'superadmin@saas.local' },
  });

  if (!superExisting) {
    const saPassword = await bcrypt.hash('SuperAdmin2026!', 12);
    await prisma.user.create({
      data: {
        email: 'superadmin@saas.local',
        name: 'Platform Admin',
        password: saPassword,
        role: 'SUPERADMIN',
        isActive: true,
      },
    });
    console.log('SuperAdmin oluşturuldu: superadmin@saas.local');
  } else {
    await prisma.user.update({
      where: { email: 'superadmin@saas.local' },
      data: { role: 'SUPERADMIN', isActive: true, organizationId: null },
    });
    console.log('SuperAdmin güncellendi.');
  }

  // Eski superadmin@atmaca.com varsa, SUPERADMIN olarak güncelle ve org'dan ayır
  const oldSuperAdmin = await prisma.user.findUnique({
    where: { email: 'superadmin@atmaca.com' },
  });
  if (oldSuperAdmin) {
    await prisma.user.update({
      where: { email: 'superadmin@atmaca.com' },
      data: { role: 'SUPERADMIN', isActive: true, organizationId: null },
    });
    console.log('Eski superadmin@atmaca.com güncellendi (org bağlantısı kaldırıldı).');
  }

  // 2. Örnek müşteri organizasyonu (Atmaca)
  let defaultOrg = await prisma.organization.findUnique({
    where: { slug: 'atmaca' },
  });

  if (!defaultOrg) {
    defaultOrg = await prisma.organization.create({
      data: {
        name: 'Atmaca',
        slug: 'atmaca',
        plan: 'ENTERPRISE',
        maxUsers: 50,
        maxSessions: 10,
        isActive: true,
      },
    });
    console.log(`Müşteri organizasyonu oluşturuldu: ${defaultOrg.name}`);
  } else {
    console.log(`Organizasyon zaten mevcut: ${defaultOrg.name}`);
  }

  // 3. Atmaca Admin kullanıcısını oluştur/güncelle
  const existing = await prisma.user.findUnique({
    where: { email: 'admin@atmaca.com' },
  });

  if (existing) {
    await prisma.user.update({
      where: { email: 'admin@atmaca.com' },
      data: {
        role: 'ADMIN',
        isActive: true,
        organizationId: defaultOrg.id,
      },
    });
    console.log('Atmaca Admin güncellendi.');
  } else {
    const password = await bcrypt.hash('Atmaca2026!', 12);
    await prisma.user.create({
      data: {
        email: 'admin@atmaca.com',
        name: 'Atmaca Admin',
        password,
        role: 'ADMIN',
        isActive: true,
        organizationId: defaultOrg.id,
      },
    });
    console.log('Atmaca Admin oluşturuldu: admin@atmaca.com');
  }

  // 4. SUPERADMIN olmayan ve org'u olmayan kullanıcıları varsayılan org'a bağla
  const unlinkedUsers = await prisma.user.updateMany({
    where: { organizationId: null, role: { not: 'SUPERADMIN' } },
    data: { organizationId: defaultOrg.id },
  });
  if (unlinkedUsers.count > 0) {
    console.log(`${unlinkedUsers.count} kullanıcı organizasyona bağlandı.`);
  }

  const unlinkedSessions = await prisma.whatsappSession.updateMany({
    where: { organizationId: null },
    data: { organizationId: defaultOrg.id },
  });
  if (unlinkedSessions.count > 0) {
    console.log(`${unlinkedSessions.count} oturum organizasyona bağlandı.`);
  }

  const unlinkedContacts = await prisma.contact.updateMany({
    where: { organizationId: null },
    data: { organizationId: defaultOrg.id },
  });
  if (unlinkedContacts.count > 0) {
    console.log(`${unlinkedContacts.count} kişi organizasyona bağlandı.`);
  }

  console.log('\nSeed tamamlandı!');
  console.log(`  Müşteri Org: ${defaultOrg.name} (${defaultOrg.slug})`);
  console.log(`  Atmaca Admin: admin@atmaca.com / Atmaca2026!`);
  console.log(`  Platform SuperAdmin: superadmin@saas.local / SuperAdmin2026!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
