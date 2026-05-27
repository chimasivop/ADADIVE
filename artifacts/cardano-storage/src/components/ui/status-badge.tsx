import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  let colorClass = "bg-muted text-muted-foreground";
  
  switch (status.toLowerCase()) {
    case "active":
      colorClass = "bg-primary/20 text-primary border-primary/30";
      break;
    case "pending":
      colorClass = "bg-chart-2/20 text-chart-2 border-chart-2/30";
      break;
    case "completed":
      colorClass = "bg-chart-4/20 text-chart-4 border-chart-4/30";
      break;
    case "failed":
    case "inactive":
      colorClass = "bg-destructive/20 text-destructive border-destructive/30";
      break;
  }

  return (
    <Badge variant="outline" className={cn("font-mono uppercase text-[10px] tracking-wider font-semibold", colorClass, className)}>
      {status}
    </Badge>
  );
}
