import { SignInForm } from "@/components/sign-in-form";
import { isDebugDemoMode } from "@/lib/runtime";

export default function SignInPage() {
  return <SignInForm debugMode={isDebugDemoMode} />;
}
