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
    <Card className={cn("bg-card/60 backdrop-blur-sm border-primary/15", className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between pb-3">
          <p
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: "9px",
              letterSpacing: "0.22em",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            {String(title).toUpperCase()}
          </p>
          {Icon && <Icon className="size-3.5 text-primary opacity-70" />}
        </div>
        <div className="flex flex-col gap-1.5">
          {loading ? (
            <>
              <Skeleton className="h-8 w-28 bg-primary/10" />
              {subtitle && <Skeleton className="h-3 w-32 bg-primary/10 mt-1" />}
            </>
          ) : (
            <>
              {/* Value in bright gold */}
              <div
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: "22px",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: "hsl(var(--primary))",
                  lineHeight: 1.2,
                }}
              >
                {value !== undefined ? value : "—"}
              </div>
              {subtitle && (
                <p
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "10px",
                    letterSpacing: "0.08em",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
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
