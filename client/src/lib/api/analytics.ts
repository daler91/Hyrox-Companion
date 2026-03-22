import { apiRequest } from "@/lib/queryClient";

export async function getPersonalRecords(dateParams: string = ""): Promise<any> {
  const response = await apiRequest("GET", `/api/v1/personal-records${dateParams}`);
  return response.json();
}

export async function getExerciseAnalytics(dateParams: string = ""): Promise<any> {
  const response = await apiRequest("GET", `/api/v1/exercise-analytics${dateParams}`);
  return response.json();
}
