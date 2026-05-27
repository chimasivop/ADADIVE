import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value?: string | number | ReactNode;
  subtitle?: string;
  icon?: React.ElementType;
  loading?: boolean;
  className?: string;
}

export function StatCard({ title, value, subtitle, icon: Icon, loading, className }: StatCardProps) {
  return (
    <Card className={cn("bg-card/50 backdrop-blur-sm border-primary/20", className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between space-y-0 pb-2">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-mono">
            {title}
          </p>
          {Icon && <Icon className="size-4 text-primary" />}
        </div>
        <div className="flex flex-col gap-1">
          {loading ? (
            <>
              <Skeleton className="h-8 w-24 bg-primary/10" />
              {subtitle && <Skeleton className="h-4 w-32 bg-primary/10 mt-1" />}
            </>
          ) : (
            <>
              <div className="text-2xl font-bold font-mono tracking-tight text-primary-foreground">
                {value !== undefined ? value : "--"}
              </div>
              {subtitle && (
                <p className="text-xs text-muted-foreground font-mono">
                  {subtitle}
                </p>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
