import re

with open('client/src/components/timeline/TimelineFilters.tsx', 'r') as f:
    content = f.read()

# Make sure imports are clean
if 'import {\n  Tooltip,\n  TooltipContent,\n  TooltipTrigger,\n} from "@/components/ui/tooltip";\nimport {\n  Tooltip,\n  TooltipContent,\n  TooltipTrigger,\n} from "@/components/ui/tooltip";' in content:
    content = content.replace('import {\n  Tooltip,\n  TooltipContent,\n  TooltipTrigger,\n} from "@/components/ui/tooltip";\nimport {\n  Tooltip,\n  TooltipContent,\n  TooltipTrigger,\n} from "@/components/ui/tooltip";', 'import {\n  Tooltip,\n  TooltipContent,\n  TooltipTrigger,\n} from "@/components/ui/tooltip";')

with open('client/src/components/timeline/TimelineFilters.tsx', 'w') as f:
    f.write(content)
