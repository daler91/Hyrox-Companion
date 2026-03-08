import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function TimelineSkeleton() {
  return (
    <div className="space-y-6">
      {[1, 2, 3].map((group) => (
        <div key={group}>
          <div className="flex items-center gap-3 mb-3 h-6">
            <Skeleton className="h-3 w-3 rounded-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-16 ml-auto" />
          </div>
          <div className="space-y-3 ml-6">
            {[1, 2].map((item) => (
              <Card key={item}>
                <CardContent className="p-4" style={{ minHeight: "5.5rem" }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-16" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-3/4" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
