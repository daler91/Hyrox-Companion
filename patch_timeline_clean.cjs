const fs = require('fs');
const path = 'client/src/pages/Timeline.tsx';
let content = fs.readFileSync(path, 'utf8');

// The original file is clean now. Let's do a single, clean replacement pass.

// 1. imports
content = content.replace(
  'import { isToday, parseISO } from "date-fns";',
  'import { isToday, parseISO, format } from "date-fns";'
);
content = content.replace(
  'import { useTimelineState } from "@/hooks/useTimelineState";',
  'import { useVirtualizer } from "@tanstack/react-virtual";\nimport { useRef, useMemo, useCallback } from "react";\nimport { useTimelineState } from "@/hooks/useTimelineState";'
);

// 2. Destructure block relocation
const destructureRegex = /const \{\s*plans,\s*plansLoading,[\s\S]*?updatePlanGoalMutation,\s*\} = state;/m;
const match = content.match(destructureRegex);

if (match) {
  content = content.replace(match[0], '');
  content = content.replace(
    'const state = useTimelineState();\n  const { user } = useAuth();',
    `const state = useTimelineState();
  ${match[0]}
  const { user } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);`
  );
}

// 3. Virtualizer Logic
const virtualizerLogic = `
  const allVisibleGroups = useMemo(() => {
    return [...visiblePastGroups.slice().reverse(), ...visibleFutureGroups];
  }, [visiblePastGroups, visibleFutureGroups]);

  const rowVirtualizer = useVirtualizer({
    count: allVisibleGroups.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 150,
    overscan: 5,
  });

  const handleScrollToToday = useCallback(() => {
    const todayIndex = allVisibleGroups.findIndex(([date]) => date === format(new Date(), "yyyy-MM-dd"));
    if (todayIndex !== -1) {
      rowVirtualizer.scrollToIndex(todayIndex, { align: 'start', behavior: 'smooth' });
    } else {
      scrollToToday();
    }
  }, [allVisibleGroups, rowVirtualizer, scrollToToday]);
`;

content = content.replace(
  '  const scrollRef = useRef<HTMLDivElement>(null);',
  '  const scrollRef = useRef<HTMLDivElement>(null);\n' + virtualizerLogic
);

// 4. Header & Container updates
content = content.replace(
  '<TimelineHeader\n            onScrollToToday={scrollToToday}\n          />',
  '<TimelineHeader\n            onScrollToToday={handleScrollToToday}\n          />'
);

content = content.replace(
  '<div className="flex-1 overflow-auto p-4 md:p-8">',
  '<div ref={scrollRef} className="flex-1 overflow-auto p-4 md:p-8 relative">'
);

// 5. Virtual List Render
const mapRegex = /\{\[\.\.\.visiblePastGroups\.slice\(\)\.reverse\(\),\s*\.\.\.visibleFutureGroups\]\.map\(\(\[date, entries\]\) => \([\s\S]*?isAutoCoaching=\{\!\!user\?\.isAutoCoaching\}\s*\/>\s*\)\)\}/m;

const virtualList = `
            <div style={{ position: 'relative' }}>
              {(() => {
                const virtualItems = rowVirtualizer.getVirtualItems();
                if (virtualItems.length === 0) return null;
                const activeIndex = virtualItems[0].index;
                const [date] = allVisibleGroups[activeIndex];
                const dateObj = parseISO(date);
                const isTodayDate = isToday(dateObj);
                const isPast = !isTodayDate && dateObj < new Date();

                const getDateLabel = (d) => {
                  if (isToday(d)) return "Today";
                  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
                  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
                  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
                  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
                  return format(d, "EEEE, MMM d");
                };

                return (
                  <div className="sticky top-0 z-20 bg-background/95 backdrop-blur py-2 shadow-sm mb-4 flex items-center gap-3 w-full border-b" style={{ marginTop: '-1rem' }}>
                    <div className={\`h-3 w-3 rounded-full \${isTodayDate ? "bg-primary" : isPast ? "bg-muted-foreground/30" : "bg-muted-foreground/50"}\`} />
                    <span className={isTodayDate ? "text-primary font-semibold" : "text-muted-foreground font-semibold"}>
                      {getDateLabel(dateObj)}
                    </span>
                  </div>
                );
              })()}

              <div style={{ height: \`\${rowVirtualizer.getTotalSize()}px\`, width: '100%', position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const [date, entries] = allVisibleGroups[virtualRow.index];
                  return (
                    <div
                      key={virtualRow.key}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: \`translateY(\${virtualRow.start}px)\`,
                      }}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                    >
                      <TimelineDateGroup
                        key={date}
                        ref={isToday(parseISO(date)) ? todayRef : undefined}
                        date={date}
                        entries={entries}
                        onMarkComplete={handleMarkComplete}
                        onClick={openDetailDialog}
                        onCombineSelect={handleCombine}
                        isCombining={!!combiningEntry}
                        combiningEntryId={combiningEntry?.id || null}
                        combiningEntryDate={combiningEntry?.date || null}
                        personalRecords={personalRecords}
                        isAutoCoaching={!!user?.isAutoCoaching}
                      />
                    </div>
                  );
                })}
              </div>
            </div>`;

content = content.replace(mapRegex, virtualList);

fs.writeFileSync(path, content);
console.log("Timeline clean patched!");
