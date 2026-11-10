import { useQueryClient } from "@tanstack/react-query";
import type { CommandOutput } from "../../../../core/commands/index.ts";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { execute } from "../../../lib/data/query.ts";
import { toast } from "../../../lib/toast.ts";

export type Space = CommandOutput<"rag.spaces">[number];

export function DropSpace({ space: s, label, onClose }: { space: Space; label: string; onClose: () => void }) {
  const client = useQueryClient();
  const drop = async () => {
    const r = await execute(
      client,
      "rag.dropSpace",
      { id: s.id, force: s.active },
      {
        invalidates: [["rag.spaces"], ["rag.status"], ["docs.list"], ["models.advice"]],
      },
    );
    onClose();
    toast({ tone: "success", title: "Vector space dropped", detail: `${r.dropped} · ${r.freedMB} MB freed` });
  };
  return (
    <Modal
      size="sm"
      title={`Drop the ${label} vectors?`}
      confirm={{ verb: `Drop ${s.sizeMB} MB`, danger: true, onConfirm: drop }}
      consequences={[
        [s.chunks, "vectors deleted from the index"],
        [`${s.sizeMB} MB`, "freed on this PC"],
      ]}
      consequencesAt="start"
      onClose={onClose}
    >
      {s.active && (
        <Banner tone="warning" compact>
          This PC searches with it: search falls back to words only until you reindex.
        </Banner>
      )}
    </Modal>
  );
}
