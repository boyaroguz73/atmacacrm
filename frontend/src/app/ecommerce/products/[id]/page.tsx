import { redirect } from 'next/navigation';

/** Eski detay rotası: ana ürün detayına yönlendir. */
export default function EcommerceProductDetailRedirectPage({ params }: { params: { id: string } }) {
  redirect(`/products/${params.id}`);
}
