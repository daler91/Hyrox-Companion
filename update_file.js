const fs = require('fs');

const filePath = 'client/src/components/timeline/TimelineFilters.tsx';
let content = fs.readFileSync(filePath, 'utf8');

const helperFunction = `
  const renderPlanSelector = () => {
    if (plansLoading) {
      return (
        <div className="flex items-center gap-2 flex-1">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Loading plans...</span>
        </div>
      );
    }

    if (plans.length > 0) {
      return (
        <div className="flex items-center gap-1 flex-1 sm:min-w-[200px]">
          <Select
            value={selectedPlanId || "__all__"}
            onValueChange={(value) => onPlanChange(value === "__all__" ? null : value)}
          >
            <SelectTrigger id="plan-select" aria-label="Select training plan" className="flex-1" data-testid="select-plan">
              <SelectValue placeholder="All Plans" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Plans</SelectItem>
              {plans.map((plan) => (
                <SelectItem key={plan.id} value={plan.id}>
                  {plan.name} ({plan.totalWeeks} weeks)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedPlanId && (
            <Button
              size="icon"
              variant="ghost"
              onClick={openRenameDialog}
              data-testid="button-rename-plan" aria-label="Rename plan"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className="flex-1 flex items-center">
        <span className="text-sm text-muted-foreground">No plans yet</span>
      </div>
    );
  };
`;

const replaceTarget = `{plansLoading ? (
            <div className="flex items-center gap-2 flex-1">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Loading plans...</span>
            </div>
          ) : plans.length > 0 ? (
            <div className="flex items-center gap-1 flex-1 sm:min-w-[200px]">
              <Select
                value={selectedPlanId || "__all__"}
                onValueChange={(value) => onPlanChange(value === "__all__" ? null : value)}
              >
                <SelectTrigger id="plan-select" aria-label="Select training plan" className="flex-1" data-testid="select-plan">
                  <SelectValue placeholder="All Plans" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Plans</SelectItem>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} ({plan.totalWeeks} weeks)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPlanId && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={openRenameDialog}
                  data-testid="button-rename-plan" aria-label="Rename plan"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center">
              <span className="text-sm text-muted-foreground">No plans yet</span>
            </div>
          )}`;

const insertionPoint = 'return (';

const newContent = content.replace(insertionPoint, helperFunction + '\n  ' + insertionPoint).replace(replaceTarget, '{renderPlanSelector()}');

fs.writeFileSync(filePath, newContent, 'utf8');
