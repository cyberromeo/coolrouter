import { redirect } from "next/navigation";
import "@/lib/backgroundServices";

export default function InitPage() {
  redirect("/dashboard");
}
