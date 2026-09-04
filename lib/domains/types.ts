import type { PlanActionFn } from "@/lib/grid-engine";

export type FieldType = "string" | "number" | "boolean" | "date" | "enum";

export type FieldDef<TRecord> = {
  key: keyof TRecord & string;
  label: string;
  type: FieldType;
  enumValues?: readonly string[];
};

export type ActionDef<TActionId extends string> = {
  id: TActionId;
  label: string;
  description: string;
};

/**
 * Everything a RelayGrid view needs to run one industry domain: the record
 * shape, the fields an agent may query/sort on, the actions it may request,
 * and how to plan + generate that domain's data. Swapping domains (e.g. to
 * the future Healthcare worklist) means writing one new module that
 * satisfies this contract — the engine, tools, and chat plumbing stay put.
 */
export type DomainConfig<TRecord extends { id: string }, TActionId extends string> = {
  id: string;
  name: string;
  recordLabel: string;
  batchSize: number;
  fields: FieldDef<TRecord>[];
  actions: ActionDef<TActionId>[];
  generateRecords: (count?: number) => TRecord[];
  planAction: PlanActionFn<TRecord, TActionId>;
  examplePrompts: string[];
};
