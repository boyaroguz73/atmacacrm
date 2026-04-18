/**
 * REST1 `/rest1/customer/setCustomers` yanıtından müşteri kimliği çıkarır.
 * T-Soft sürümleri: data dizi | tek obje | kökte CustomerId, farklı büyük/küçük harf.
 */
export function extractTsoftCustomerIdFromSetCustomersResponse(res: unknown): string | null {
  if (res == null) return null;

  const tryVal = (v: unknown): string | null => {
    if (v == null) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  };

  const pickFromObject = (o: Record<string, unknown> | null | undefined): string | null => {
    if (!o) return null;
    return tryVal(
      o.CustomerId ??
        o.customerId ??
        o.CustomerID ??
        o.Id ??
        o.ID ??
        o.id ??
        o.USERID ??
        o.UserId,
    );
  };

  if (typeof res === 'string' || typeof res === 'number') {
    return tryVal(res);
  }

  if (typeof res !== 'object') return null;
  const r = res as Record<string, unknown>;

  const root = pickFromObject(r);
  if (root) return root;

  const d = r.data;
  if (Array.isArray(d) && d.length > 0) {
    const first = d[0];
    if (first != null && typeof first === 'object') {
      const fromRow = pickFromObject(first as Record<string, unknown>);
      if (fromRow) return fromRow;
    }
  }
  if (d != null && typeof d === 'object' && !Array.isArray(d)) {
    const fromData = pickFromObject(d as Record<string, unknown>);
    if (fromData) return fromData;
    const inner = (d as Record<string, unknown>).data;
    if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
      const fromInner = pickFromObject(inner as Record<string, unknown>);
      if (fromInner) return fromInner;
    }
  }

  const result = r.result;
  if (result != null && typeof result === 'object') {
    const fromResult = pickFromObject(result as Record<string, unknown>);
    if (fromResult) return fromResult;
  }

  return null;
}

/** Bazı yanıtlarda başarı alanı */
export function looksLikeTsoftSuccessResponse(res: unknown): boolean {
  if (res == null || typeof res !== 'object') return false;
  const r = res as Record<string, unknown>;
  if (r.success === true || r.Success === true) return true;
  const msg = String(r.message ?? r.Message ?? r.msg ?? '').toLowerCase();
  if (msg.includes('success') || msg === 'ok' || msg === 'true') return true;
  const code = r.code ?? r.Code ?? r.statusCode;
  if (code === 0 || code === '0' || code === 200) return true;
  return false;
}
