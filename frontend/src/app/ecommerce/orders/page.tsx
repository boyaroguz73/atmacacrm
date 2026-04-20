import { redirect } from 'next/navigation';

/** Eski rota: mağaza araçları artık /orders sayfasında (T-Soft paneli). */
export default function EcommerceOrdersRedirectPage() {
  redirect('/orders?tsoft=1');
}
