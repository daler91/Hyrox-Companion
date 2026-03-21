import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface CoachingMaterial {
  id: string;
  userId: string;
  title: string;
  content: string;
  type: "principles" | "document";
  createdAt: string;
  updatedAt: string;
}

const QUERY_KEY = ["/api/v1/coaching-materials"];

export function useCoachingMaterials() {
  return useQuery<CoachingMaterial[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/v1/coaching-materials");
      return response.json();
    },
  });
}

export function useCreateCoachingMaterial() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: { title: string; content: string; type: "principles" | "document" }) => {
      const response = await apiRequest("POST", "/api/v1/coaching-materials", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: "Coaching material added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add coaching material", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateCoachingMaterial() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; title?: string; content?: string; type?: "principles" | "document" }) => {
      const response = await apiRequest("PATCH", `/api/v1/coaching-materials/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: "Coaching material updated" });
    },
    onError: () => {
      toast({ title: "Failed to update coaching material", variant: "destructive" });
    },
  });
}

export function useDeleteCoachingMaterial() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/v1/coaching-materials/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: "Coaching material removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove coaching material", variant: "destructive" });
    },
  });
}
