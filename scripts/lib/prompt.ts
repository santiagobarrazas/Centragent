import { createInterface } from "node:readline/promises";

export type Rl = ReturnType<typeof createInterface>;

export type Choice<TValue> = {
  label: string;
  description?: string;
  value: TValue;
};

export function createRl(): Rl {
  return createInterface({ input: process.stdin, output: process.stdout });
}

export async function choose<TValue>(
  rl: Rl,
  title: string,
  choices: Array<Choice<TValue>>,
  defaultIndex: number
): Promise<TValue> {
  if (choices.length === 0) {
    throw new Error(`No choices available for ${title}`);
  }
  console.log(title);
  choices.forEach((choice, index) => {
    const marker = index === defaultIndex ? " [default]" : "";
    const description = choice.description ? ` - ${choice.description}` : "";
    console.log(`  ${index + 1}. ${choice.label}${marker}${description}`);
  });

  while (true) {
    const trimmed = (await rl.question(`Select 1-${choices.length}: `)).trim();
    if (!trimmed) {
      console.log("");
      const fallback = choices[defaultIndex] ?? choices[0];
      if (!fallback) throw new Error(`No default choice for ${title}`);
      return fallback.value;
    }
    const selected = Number.parseInt(trimmed, 10);
    if (Number.isInteger(selected) && selected >= 1 && selected <= choices.length) {
      console.log("");
      const choice = choices[selected - 1];
      if (choice) return choice.value;
    }
    console.log("Please enter one of the listed numbers.");
  }
}

export async function chooseMultiple<TValue extends string>(
  rl: Rl,
  title: string,
  choices: Array<Choice<TValue>>,
  defaultValues: TValue[]
): Promise<TValue[]> {
  console.log(title);
  choices.forEach((choice, index) => {
    const marker = defaultValues.includes(choice.value) ? " [default]" : "";
    const description = choice.description ? ` - ${choice.description}` : "";
    console.log(`  ${index + 1}. ${choice.label}${marker}${description}`);
  });
  console.log("  0. Skip / none");

  while (true) {
    const trimmed = (
      await rl.question("Select comma-separated numbers, Enter for defaults: ")
    ).trim();
    if (!trimmed) {
      console.log("");
      return defaultValues;
    }
    if (trimmed === "0") {
      console.log("");
      return [];
    }
    const indexes = trimmed
      .split(",")
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((value) => Number.isInteger(value));
    if (indexes.length > 0 && indexes.every((v) => v >= 1 && v <= choices.length)) {
      console.log("");
      return Array.from(
        new Set(
          indexes
            .map((index) => choices[index - 1]?.value)
            .filter((value): value is TValue => Boolean(value))
        )
      );
    }
    console.log("Please enter comma-separated numbers from the list, or 0.");
  }
}

export async function confirm(rl: Rl, question: string, defaultValue: boolean) {
  const suffix = defaultValue ? "Y/n" : "y/N";
  const answer = (await rl.question(`${question} (${suffix}) `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

/** Prompt for a value with a current/suggested default (Enter keeps, "auto" uses suggested). */
export async function promptEnvValue(
  rl: Rl,
  input: { key: string; current: string | undefined; suggested: string; label: string }
) {
  const current = input.current?.trim();
  const prompt = current
    ? `${input.label} (${input.key}) is "${current}". Enter to keep, "auto" for "${input.suggested}", or a new value: `
    : `${input.label} (${input.key}) [${input.suggested}]: `;
  const answer = (await rl.question(prompt)).trim();
  if (!answer && current) return current;
  if (!answer || answer.toLowerCase() === "auto") return input.suggested;
  return answer;
}

/** Prompt for an optional secret; only sets it when a value is entered. */
export async function promptOptionalEnvValue(input: {
  rl: Rl;
  env: Record<string, string>;
  updates: Record<string, string>;
  key: string;
  label: string;
}) {
  const existing = input.env[input.key];
  const prompt = existing
    ? `${input.label} is already set. Enter to keep, or paste a replacement: `
    : `${input.label} is not set. Paste it now, or Enter to skip: `;
  const answer = await input.rl.question(prompt);
  if (answer.trim()) {
    input.updates[input.key] = answer.trim();
  }
}
