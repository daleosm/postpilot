"use client";
import { Button } from "@heroui/react";
export default function ErrorPage({ reset }: { reset: () => void }) { return <div className="panel mx-auto mt-16 max-w-md p-8 text-center"><h1 className="text-lg font-semibold">Couldn’t load this workspace</h1><p className="mt-2 text-sm text-[#747977]">Try again, or return to the dashboard if the problem continues.</p><Button variant="primary" onPress={reset} className="mt-5 bg-[#263130] text-white">Try again</Button></div>; }
