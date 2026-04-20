import { redirect } from 'next/navigation';

/** E-Ticaret altı ürünler, ana ürün ekranını kullanır. */
export default function EcommerceProductsRedirectPage() {
  redirect('/products');
}
