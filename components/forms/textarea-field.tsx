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
import { Textarea } from "@/components/ui/textarea";

type Props<T extends FieldValues, N extends FieldPath<T>> = UseControllerProps<T, N> & {
  label: string;
  description?: string;
  textareaProps?: ComponentProps<typeof Textarea>;
};

/**
 * Campo de texto de várias linhas do formulário. Irmão do `TextField` de
 * `components/forms/form-field.tsx` — mesma estrutura, mesma acessibilidade,
 * só troca o `<Input>` pelo `<Textarea>`.
 *
 *   <TextareaField name="systemPrompt" control={form.control} label="Instruções" />
 *
 * Passa por `<FormField>` de propósito: é o que liga a mensagem de erro ao
 * campo pra leitor de tela. Sem isso, quem usa leitor ouve só "campo inválido"
 * e não descobre qual era o problema.
 */
export function TextareaField<T extends FieldValues, N extends FieldPath<T>>({
  label,
  description,
  textareaProps,
  ...controller
}: Props<T, N>) {
  return (
    <FormField
      {...controller}
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Textarea {...textareaProps} {...field} value={field.value ?? ""} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          {fieldState.error && <FormMessage>{fieldState.error.message}</FormMessage>}
        </FormItem>
      )}
    />
  );
}
