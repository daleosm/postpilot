import { SignInForm } from "@/components/sign-in-form";
import { isDebugMode } from "@/lib/runtime";

export default function SignInPage() {
  return <SignInForm debugMode={isDebugMode} />;
}
