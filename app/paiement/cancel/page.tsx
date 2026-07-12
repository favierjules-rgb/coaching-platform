import type { Metadata } from "next";

import { PaymentCancelContent } from "@/components/shared/PaymentCancelContent";

export const metadata: Metadata = {
  title: "Paiement annulé — Seth Préparation Physique",
};

export default function PaymentCancelPage() {
  return <PaymentCancelContent />;
}
