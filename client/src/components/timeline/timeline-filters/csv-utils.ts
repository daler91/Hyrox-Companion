export const CSV_TEMPLATE = `Week,Day,Focus,Main Workout,Accessory,Notes
1,Monday,Running,5km easy run at conversational pace,Core work: 3x20 planks,Recovery focus
1,Wednesday,SkiErg,4x500m SkiErg with 90s rest,Upper body strength: 3x10 rows,Build endurance
1,Friday,Sled Work,Sled push 4x50m + Sled pull 4x50m,Lunges 3x12 each leg,Technique focus
1,Saturday,Hyrox Simulation,Mini simulation: 1km run + 500m SkiErg + 1km run,Stretching,Race prep
2,Monday,Running,6km tempo run with 2km warmup,Core circuit,Build speed
2,Wednesday,Rowing,5x500m row with 60s rest,Pull-ups 3x8,Power development
2,Friday,Burpees + Wall Balls,80 burpees for time + 100 wall balls,Mobility work,Station practice
2,Saturday,Long Run,10km easy pace,Foam rolling,Aerobic base`;

export function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "training_template.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
