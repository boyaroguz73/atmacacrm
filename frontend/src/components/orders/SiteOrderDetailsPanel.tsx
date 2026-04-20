'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Store } from 'lucide-react';

type RawRow = Record<string, unknown>;

type Props = {
  data: RawRow | null | undefined;
};

function pickString(...keys: unknown[]): string {
  for (const k of keys) {
    if (k == null) continue;
    const s = String(k).trim();
    if (s) return s;
  }
  return '';
}

function formatTsDate(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'number' || (typeof v === 'string' && /^\d{10,}$/.test(v))) {
    const ts = Number(v);
    const d = new Date(ts < 1e12 ? ts * 1000 : ts);
    return d.toLocaleString('tr-TR');
  }
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toLocaleString('tr-TR') : String(v);
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 break-words">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  const hasContent = arr.some((c) => c);
  if (!hasContent) return null;
  return (
    <div className="rounded-lg border border-gray-100 bg-white p-3 space-y-1.5">
      <h4 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export default function SiteOrderDetailsPanel({ data }: Props) {
  const [open, setOpen] = useState(true);
  const [showRaw, setShowRaw] = useState(false);

  const f = useMemo(() => {
    if (!data) return null;
    return {
      orderCode: pickString(data.OrderCode, data.orderCode),
      orderId: pickString(data.OrderId, data.orderId),
      status: pickString(data.OrderStatus, data.orderStatus),
      statusId: pickString(data.OrderStatusId, data.orderStatusId),
      orderDate: formatTsDate(data.OrderDateTimeStamp ?? data.OrderDate),
      updateDate: formatTsDate(data.UpdateDateTimeStamp ?? data.UpdateDate),
      total: pickString(data.OrderTotalPrice),
      paymentInfo: pickString(data.PaymentInfo),
      paymentType: pickString(data.PaymentType),
      bank: pickString(data.Bank),
      installment: pickString(data.Installment),
      cargo: pickString(data.Cargo),
      cargoTracking: pickString(data.CargoTrackingCode),
      cargoCode: pickString(data.CargoCode),
      cargoCharge: pickString(data.CargoChargeWithoutVat),
      cargoVat: pickString(data.CargoVatPercent),
      serviceName: pickString(data.ServiceName),
      serviceCharge: pickString(data.ServiceChargeWithVat, data.ServiceChargeWithoutVat),
      serviceVat: pickString(data.ServiceVatPercent),
      customerId: pickString(data.CustomerId),
      customerCode: pickString(data.CustomerCode),
      customerName: pickString(data.CustomerName),
      customerEmail: pickString(data.CustomerUsername),
      voucherCode: pickString(data.VoucherCode),
      voucherType: pickString(data.VoucherDiscountType),
      voucherValue: pickString(data.VoucherDiscountValue),
      representative: pickString(data.RepresentativeName, data.RepresentativeCode),
      deliveryDate: formatTsDate(data.DeliveryDateTimeStamp ?? data.DeliveryDate),
      // Fatura adresi
      invoiceType: pickString(data.InvoiceType),
      invoicePerson: pickString(data.InvoicePersonName, data.InvoiceName),
      invoiceCompany: pickString(data.InvoiceCompanyName, data.InvoiceCompany),
      invoiceTaxDept: pickString(data.InvoiceTaxDepartment, data.InvoiceTaxdep),
      invoiceTaxNo: pickString(data.InvoiceTaxno),
      invoiceIdNo: pickString(data.InvoicePersonIdentityNumber),
      invoiceAddress: pickString(data.InvoiceAddress),
      invoiceCity: pickString(data.InvoiceCity),
      invoiceTown: pickString(data.InvoiceTown, data.InvoiceNeighbourhood),
      invoiceProvince: pickString(data.InvoiceProvince),
      invoiceCountry: pickString(data.Invoice_country),
      invoiceZip: pickString(data.InvoiceZipcode),
      invoiceMobile: pickString(data.InvoiceMobile),
      invoiceTel: pickString(data.InvoiceTel),
      // Teslimat adresi
      deliveryName: pickString(data.DeliveryName),
      deliveryAddress: pickString(data.DeliveryAddress),
      deliveryCity: pickString(data.DeliveryCity),
      deliveryTown: pickString(data.DeliveryTown, data.DeliveryNeighbourhood),
      deliveryCountry: pickString(data.DeliveryCountry),
      deliveryZip: pickString(data.DeliveryZipcode),
      deliveryMobile: pickString(data.DeliveryMobile),
      deliveryTel: pickString(data.DeliveryTel),
      orderNote: pickString(data.OrderNote),
    };
  }, [data]);

  if (!data || !f) return null;

  const fmtAddr = (line: string | undefined, city: string | undefined, town: string | undefined, zip?: string, country?: string) => {
    const parts = [line, town, city, zip, country].filter(Boolean);
    return parts.length ? parts.join(', ') : '';
  };

  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 border-b border-amber-100 bg-amber-50/60 hover:bg-amber-100/60 transition"
      >
        <div className="flex items-center gap-2">
          <Store className="w-4 h-4 text-amber-700" />
          <span className="text-sm font-semibold text-amber-900">Site siparişi ayrıntıları (T-Soft)</span>
          {f.orderCode ? (
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white border border-amber-200 text-amber-900">
              {f.orderCode}
            </span>
          ) : null}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-amber-700" /> : <ChevronDown className="w-4 h-4 text-amber-700" />}
      </button>

      {open ? (
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <Section title="Sipariş">
              <Row label="Sipariş No" value={f.orderCode} />
              <Row label="Site ID" value={f.orderId} />
              <Row label="Durum" value={f.status || f.statusId} />
              <Row label="Tarih" value={f.orderDate} />
              <Row label="Güncellenme" value={f.updateDate} />
              <Row label="Teslim tarihi" value={f.deliveryDate} />
              <Row label="Tutar" value={f.total ? `${f.total} TL` : ''} />
              <Row label="Not" value={f.orderNote} />
            </Section>

            <Section title="Ödeme">
              <Row label="Özet" value={f.paymentInfo} />
              <Row label="Yöntem" value={f.paymentType} />
              <Row label="Banka" value={f.bank} />
              <Row label="Taksit" value={f.installment} />
            </Section>

            <Section title="Kargo">
              <Row label="Firma" value={f.cargo} />
              <Row label="Takip No" value={f.cargoTracking} />
              <Row label="Kargo Kodu" value={f.cargoCode} />
              <Row label="Bedel (KDV Hariç)" value={f.cargoCharge} />
              <Row label="KDV %" value={f.cargoVat} />
            </Section>

            <Section title="Hizmet">
              <Row label="Ad" value={f.serviceName} />
              <Row label="Bedel" value={f.serviceCharge} />
              <Row label="KDV %" value={f.serviceVat} />
            </Section>

            <Section title="Müşteri (site)">
              <Row label="Site ID" value={f.customerId} />
              <Row label="WS Kodu" value={f.customerCode} />
              <Row label="Ad Soyad" value={f.customerName} />
              <Row label="E-posta" value={f.customerEmail} />
              <Row label="Temsilci" value={f.representative} />
            </Section>

            <Section title="İndirim">
              <Row label="Kupon" value={f.voucherCode} />
              <Row label="Tip" value={f.voucherType} />
              <Row label="Değer" value={f.voucherValue} />
            </Section>

            <Section title="Fatura Adresi">
              <Row label="Tip" value={f.invoiceType} />
              <Row label="Kişi" value={f.invoicePerson} />
              <Row label="Firma" value={f.invoiceCompany} />
              <Row label="Vergi Dairesi" value={f.invoiceTaxDept} />
              <Row label="Vergi No" value={f.invoiceTaxNo} />
              <Row label="TC Kimlik" value={f.invoiceIdNo} />
              <Row
                label="Adres"
                value={fmtAddr(f.invoiceAddress, f.invoiceCity, f.invoiceTown, f.invoiceZip, f.invoiceCountry)}
              />
              <Row label="Telefon" value={[f.invoiceMobile, f.invoiceTel].filter(Boolean).join(' / ')} />
            </Section>

            <Section title="Teslimat Adresi">
              <Row label="Ad" value={f.deliveryName} />
              <Row
                label="Adres"
                value={fmtAddr(f.deliveryAddress, f.deliveryCity, f.deliveryTown, f.deliveryZip, f.deliveryCountry)}
              />
              <Row label="Telefon" value={[f.deliveryMobile, f.deliveryTel].filter(Boolean).join(' / ')} />
            </Section>
          </div>

          <div className="pt-2 border-t border-amber-100/70">
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="text-xs text-amber-800 hover:text-amber-900 underline"
            >
              {showRaw ? 'Ham veriyi gizle' : 'Ham T-Soft verisini göster'}
            </button>
            {showRaw ? (
              <pre className="mt-2 text-[11px] font-mono bg-white border border-amber-100 rounded-lg p-3 max-h-96 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(data, null, 2)}
              </pre>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
