/** REST1 order2/createOrders ve benzeri yanıtlardan numerik T-Soft sipariş kimliği */
export function extractTsoftNumericOrderIdFromApiResult(result: unknown): string | null {
  if (result == null || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const tryVal = (v: unknown) => {
    if (v == null) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  };
  const direct = tryVal(r.OrderId ?? r.orderId);
  if (direct) return direct;
  const data = r.data;
  if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === 'object') {
    const row = data[0] as Record<string, unknown>;
    const id = tryVal(row.OrderId ?? row.orderId ?? row.Id ?? row.id);
    if (id) return id;
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    const id = tryVal(d.OrderId ?? d.orderId ?? d.Id ?? d.id);
    if (id) return id;
  }
  return null;
}
