import { useMutation, type UseMutationOptions } from "@tanstack/react-query";

import { useToast } from "@/hooks/use-toast";
import { queryClient, RateLimitError } from "@/lib/queryClient";

type QueryKeyList = readonly (readonly unknown[])[];

export interface UseApiMutationOptions<TData, TError, TVariables, TContext>
  extends Omit<UseMutationOptions<TData, TError, TVariables, TContext>, 'onSuccess' | 'onError'> {
  invalidateQueries?: QueryKeyList;
  successToast?: string | ((data: TData, variables: TVariables) => { title?: string; description?: string });
  errorToast?: string | ((error: TError, variables: TVariables) => { title?: string; description?: string });
  onSuccess?: (data: TData, variables: TVariables, context: TContext) => Promise<unknown> | void;
  onError?: (error: TError, variables: TVariables, context: TContext | undefined) => Promise<unknown> | void;
}

export function useApiMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown
>(options: UseApiMutationOptions<TData, TError, TVariables, TContext>) {
  const { toast } = useToast();
  const { invalidateQueries, successToast, errorToast, onSuccess, onError, ...mutationOptions } = options;

  return useMutation<TData, TError, TVariables, TContext>({
    ...mutationOptions,
    onSuccess: async (data, variables, context) => {
      // Invalidate queries if provided
      if (invalidateQueries && invalidateQueries.length > 0) {
        await Promise.all(
          invalidateQueries.map((queryKey) =>
            queryClient.invalidateQueries({ queryKey })
          )
        );
      }

      // Show success toast
      if (successToast) {
        if (typeof successToast === "function") {
          const toastContent = successToast(data, variables);
          toast(toastContent);
        } else {
          toast({ title: successToast });
        }
      }

      // Call original onSuccess if provided
      if (onSuccess) {
        await onSuccess(data, variables, context);
      }
    },
    onError: async (error, variables, context) => {
      if (error instanceof RateLimitError) {
        const waitMsg = error.retryAfter
          ? `Please wait ${error.retryAfter} seconds before trying again.`
          : "Please wait a moment before trying again.";
        toast({
          title: "Too many requests",
          description: waitMsg,
          variant: "destructive",
        });
      } else if (errorToast) {
        if (typeof errorToast === "function") {
          const toastContent = errorToast(error, variables);
          toast({ variant: "destructive", ...toastContent });
        } else {
          toast({
            title: errorToast,
            description: error instanceof Error ? error.message : "An error occurred",
            variant: "destructive",
          });
        }
      }

      // Call original onError if provided
      if (onError) {
        await onError(error, variables, context);
      }
    },
  });
}
