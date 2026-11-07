"use client";

import type { ComponentProps } from "react";
import type { FieldPath, FieldValues, UseControllerProps } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

type Props<T extends FieldValues, N extends FieldPath<T>> = UseControllerProps<T, N> & {
  label: string;
  description?: string;
  inputProps?: ComponentProps<typeof Input>;
};

/**
 * Campo de formulário padrão do template. Use este em vez de montar
 * label + input + mensagem de erro na mão.
 *
 *   <TextField name="email" control={form.control} label="Email" />
 *
 * POR DENTRO: ele passa por `<FormField>` de propósito. É o que faz o rótulo
 * ficar vermelho quando dá erro e, principalmente, o que liga a mensagem de
 * erro ao campo pra leitor de tela — quem usa leitor ouvia só "campo inválido",
 * sem ouvir QUAL era o problema.
 */
export function TextField<T extends FieldValues, N extends FieldPath<T>>({
  label,
  description,
  inputProps,
  ...controller
}: Props<T, N>) {
  return (
    <FormField
      {...controller}
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...inputProps} {...field} value={field.value ?? ""} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          {fieldState.error && <FormMessage>{fieldState.error.message}</FormMessage>}
        </FormItem>
      )}
    />
  );
}
