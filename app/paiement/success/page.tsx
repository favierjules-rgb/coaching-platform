import type { Metadata } from "next";

import { PaymentSuccessContent } from "@/components/shared/PaymentSuccessContent";

export const metadata: Metadata = {
  title: "Paiement reçu — Seth Préparation Physique",
};

export default function PaymentSuccessPage() {
  return <PaymentSuccessContent />;
}
