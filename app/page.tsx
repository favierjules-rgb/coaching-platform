import { Hero } from "@/components/sections/Hero";
import { Method } from "@/components/sections/Method";
import { Newsletter } from "@/components/sections/Newsletter";
import { Transformations } from "@/components/sections/Transformations";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Method />
      <Transformations />
      <Newsletter />
    </>
  );
}
