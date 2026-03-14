import re

with open('client/src/components/timeline/TimelineFilters.tsx', 'r') as f:
    content = f.read()

# Add title="Rename plan" to the button
button_target = 'data-testid="button-rename-plan" aria-label="Rename plan"'
button_replacement = 'data-testid="button-rename-plan" aria-label="Rename plan" title="Rename plan"'
if button_target in content:
    content = content.replace(button_target, button_replacement)

with open('client/src/components/timeline/TimelineFilters.tsx', 'w') as f:
    f.write(content)

with open('client/src/components/timeline/TimelineWorkoutCard.tsx', 'r') as f:
    content = f.read()

# Add title={`Mark ${entry.focus} as complete`} to the complete button
button_target2 = 'aria-label={`Mark ${entry.focus} as complete`}'
button_replacement2 = 'aria-label={`Mark ${entry.focus} as complete`}\n              title={`Mark ${entry.focus} as complete`}'
if button_target2 in content:
    content = content.replace(button_target2, button_replacement2)

with open('client/src/components/timeline/TimelineWorkoutCard.tsx', 'w') as f:
    f.write(content)
