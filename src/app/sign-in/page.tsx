import { SignInForm } from "@/components/sign-in-form";
import { isDevelopmentDebugMode } from "@/lib/runtime";

export default function SignInPage() {
  return <SignInForm debugMode={isDevelopmentDebugMode} />;
}
