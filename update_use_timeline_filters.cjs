const fs = require('fs');

const filePath = 'client/src/hooks/useTimelineFilters.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Replace the nested ternary inside the sort callback
const oldSort = `    const allGroups = Object.entries(groups).sort(([a], [b]) =>
      // ⚡ Bolt Performance Optimization:
      // Compare ISO date strings ("yyyy-MM-dd") directly via simple comparison
      // rather than using localeCompare or allocating new Date() objects.
      // This is significantly faster and reduces overhead in a heavy useMemo recalculation.
      b < a ? -1 : (b > a ? 1 : 0)
    );`;

const newSort = `    const allGroups = Object.entries(groups).sort(([a], [b]) => {
      // ⚡ Bolt Performance Optimization:
      // Compare ISO date strings ("yyyy-MM-dd") directly via simple comparison
      // rather than using localeCompare or allocating new Date() objects.
      // This is significantly faster and reduces overhead in a heavy useMemo recalculation.
      if (b < a) {
        return -1;
      }
      if (b > a) {
        return 1;
      }
      return 0;
    });`;

content = content.replace(oldSort, newSort);

fs.writeFileSync(filePath, content);
