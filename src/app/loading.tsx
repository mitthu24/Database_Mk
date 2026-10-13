import { Skeleton } from "@/components/ui/skeleton";

export default function RootLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <Skeleton className="h-8 w-48" />
      <div className="mt-4 flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
