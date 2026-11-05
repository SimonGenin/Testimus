// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../../src/ui/api.ts";
import { Toaster } from "../../../../../src/ui/components/ui/Toast.tsx";
import { forComposer, forJira, pieces, putMention, typingMention } from "../../../../../src/ui/lib/mentions.ts";
import { CommentsCard } from "../../../../../src/ui/screens/tests/editor/CommentsCard.tsx";
import { JiraControls, JiraOff } from "../../../../../src/ui/screens/tests/editor/JiraControls.tsx";
import { assigneesIn, assigneesOf, toggleAssignee } from "../../../../../src/ui/screens/tests/list/assignee.ts";
import { callsOf, Fail, fakeNet, net, renderWithData } from "../../../helpers/ui-data.tsx";
import { clearToasts } from "../../../helpers/ui-screens.tsx";

afterEach(() => {
  cleanup();
  clearToasts();
  vi.unstubAllGlobals();
});

describe("mentions in the composer", () => {
  it("cuts a stored comment into text and mentions", () => {
    expect(pieces("@[Camille Martin](a2) vu. @[Léa](a3)")).toEqual([
      { name: "Camille Martin", id: "a2" },
      { text: " vu. " },
      { name: "Léa", id: "a3" },
    ]);
    expect(pieces("plain")).toEqual([{ text: "plain" }]);
  });

  it("shows « @Name » in the composer and puts the account back when it sends, longest names first", () => {
    const { text, who } = forComposer("@[Léa](a3) et @[Léa Bernard](a4).", new Map([["Hugo", "a5"]]));
    expect(text).toBe("@Léa et @Léa Bernard.");
    expect(forJira(`${text} @Hugo @Hugolin`, who)).toBe("@[Léa](a3) et @[Léa Bernard](a4). @[Hugo](a5) @Hugolin");
    expect(forJira("@Nobody", new Map())).toBe("@Nobody");
  });

  it("finds the mention being typed, and puts the name in its place", () => {
    expect(typingMention("Vu avec @ca", 11)).toEqual({ start: 8, query: "ca" });
    expect(typingMention("@", 1)).toEqual({ start: 0, query: "" });
    expect(typingMention("mail@x", 6)).toBeNull();
    expect(typingMention("@cam ille martin", 16)).toBeNull();
    expect(typingMention("@a  b", 5)).toBeNull();
    expect(putMention("Vu avec @ca", { start: 8, query: "ca" }, "Camille Martin")).toBe("Vu avec @Camille Martin ");
    expect(putMention("@ca, merci", { start: 0, query: "ca" }, "Camille")).toBe("@Camille , merci");
    expect(putMention("@ca merci", { start: 0, query: "ca" }, "Camille")).toBe("@Camille merci");
  });
});

describe("the list's Assignee filter", () => {
  it("ticks and unticks assignee: words in the filter box", () => {
    expect(toggleAssignee("menu", "me")).toBe("menu assignee:me");
    expect(toggleAssignee("menu assignee:me", "ME")).toBe("menu");
    expect(toggleAssignee("", "Camille Martin")).toBe('assignee:"Camille Martin"');
    expect(assigneesIn('a assignee:"Camille Martin" assignee:none')).toEqual(["Camille Martin", "none"]);
    expect(toggleAssignee('assignee:"Camille Martin" x', "camille martin")).toBe("x");
  });

  it("counts who the local tests are assigned to, most first", () => {
    const ref = (assignee?: string, assigneeId?: string) => ({ id: "x", assignee, assigneeId }) as never;
    expect(assigneesOf([ref("Léa", "a3"), ref(), ref("Camille", "a2"), ref("Camille", "a2"), ref()])).toEqual({
      people: [
        { name: "Camille", id: "a2", count: 2 },
        { name: "Léa", id: "a3", count: 1 },
      ],
      unassigned: 2,
    });
  });
});

describe("the head's Jira controls", () => {
  beforeEach(() => {
    fakeNet();
    setProject("C:/p");
  });

  it("asks Jira where the issue can go only when opened, and moves it", async () => {
    net.routes["issue.transitions"] = () => ({
      status: "To Do",
      category: "new",
      transitions: [{ id: "11", name: "Start testing", to: "In Progress", category: "indeterminate" }],
    });
    net.routes["issue.transition"] = () => ({
      key: "P-1",
      from: "To Do",
      to: "In Progress",
      name: "Start testing",
      dryRun: false,
      status: "In Progress",
      category: "indeterminate",
      assignee: null,
      local: true,
      undo: { id: "41", name: "Back", to: "To Do", category: "new" },
    });
    renderWithData(
      <>
        <JiraControls testKey="P-1" status="To Do" comments={2} onComments={() => {}} />
        <Toaster />
      </>,
    );
    expect(callsOf("issue.transitions")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "2 comments" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("jira-status"));
    const item = await screen.findByRole("menuitem", { name: /Start testing/ });
    expect(within(item).getByText("→ In Progress")).toBeInTheDocument();
    fireEvent.click(item);
    await waitFor(() => expect(callsOf("issue.transition")[0]?.input).toEqual({ key: "P-1", transition: "11" }));
    expect(await screen.findByText("P-1 is In Progress in Jira")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(callsOf("issue.transition")[1]?.input).toEqual({ key: "P-1", transition: "41" }));
  });

  it("says when the workflow allows no move, and Jira's error", async () => {
    net.routes["issue.transitions"] = () => ({ status: "Done", category: "done", transitions: [] });
    const { unmount } = renderWithData(
      <JiraControls testKey="P-1" status="Done" comments={null} onComments={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("jira-status"));
    expect(await screen.findByText("Jira's workflow allows no move from Done.")).toBeInTheDocument();
    unmount();
    net.routes["issue.transitions"] = () => {
      throw new Fail("Jira 404 — issue P-1 not found");
    };
    renderWithData(<JiraControls testKey="P-1" status="Done" comments={0} onComments={() => {}} />);
    fireEvent.click(screen.getByTestId("jira-status"));
    expect(await screen.findByText(/issue P-1 not found/)).toBeInTheDocument();
  });

  it("assigns to me, to someone found by name, or to nobody", async () => {
    net.routes["issue.people"] = (i) => ({
      me: { accountId: "a1", name: "Mock Tester" },
      people: [
        { accountId: "a1", name: "Mock Tester" },
        { accountId: "a2", name: "Camille Martin" },
      ].filter((p) => !i.query || p.name.toLowerCase().includes(String(i.query).toLowerCase())),
    });
    net.routes["issue.assign"] = (i) => ({
      key: "P-1",
      from: null,
      dryRun: false,
      status: "To Do",
      category: "new",
      assignee:
        i.to === "a1"
          ? { accountId: "a1", name: "Mock Tester" }
          : i.to
            ? { accountId: "a2", name: "Camille Martin" }
            : null,
      local: true,
    });
    renderWithData(
      <>
        <JiraControls
          testKey="P-1"
          status="To Do"
          assignee="Camille Martin"
          assigneeId="a2"
          comments={0}
          onComments={() => {}}
        />
        <Toaster />
      </>,
    );
    fireEvent.click(screen.getByTestId("jira-assignee"));
    const people = await screen.findByRole("listbox", { name: "People" });
    await waitFor(() => expect(within(people).getAllByRole("option")).toHaveLength(4));
    for (const name of ["Assign to me", "Unassigned", "Mock Tester · you", "Camille Martin"])
      expect(within(people).getByRole("option", { name })).toBeInTheDocument();
    fireEvent.click(within(people).getByRole("option", { name: "Assign to me" }));
    await waitFor(() => expect(callsOf("issue.assign")[0]?.input).toEqual({ key: "P-1", to: "a1" }));
    fireEvent.click(screen.getByTestId("jira-assignee"));
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search people" }), { target: { value: "cam" } });
    await waitFor(() => expect(callsOf("issue.people").at(-1)?.input).toEqual({ key: "P-1", query: "cam" }));
    fireEvent.click(await screen.findByRole("option", { name: "Camille Martin" }));
    await waitFor(() => expect(callsOf("issue.assign")[1]?.input).toEqual({ key: "P-1", to: "a2" }));
    expect(await screen.findByText("P-1 is assigned to Camille Martin")).toBeInTheDocument();
  });

  it("without Jira: a local test says where they come from, a disconnected one shows the last pull", () => {
    const { rerender } = renderWithData(<JiraOff local />);
    expect(screen.getByText(/come with the Jira issue/)).toBeInTheDocument();
    rerender(<JiraOff local={false} status="In Progress" assignee="Léa Bernard" assigneeId="a3" />);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Léa Bernard")).toBeInTheDocument();
    expect(screen.getByText("Jira not connected")).toBeInTheDocument();
  });
});

const COMMENTS = [
  {
    id: "1",
    author: { accountId: "a2", name: "Camille Martin" },
    mine: false,
    body: "Le menu a changé.",
    created: "2026-11-03T14:02:00.000Z",
    updated: "2026-11-03T14:02:00.000Z",
  },
  {
    id: "2",
    author: { accountId: "a1", name: "Mock Tester" },
    mine: true,
    body: "@[Camille Martin](a2) vu.",
    created: "2026-11-04T09:15:00.000Z",
    updated: "2026-11-04T10:00:00.000Z",
  },
];

describe("the comments card", () => {
  beforeEach(() => {
    fakeNet();
    setProject("C:/p");
    net.routes["issue.comments"] = () => ({ comments: COMMENTS });
    net.routes["issue.people"] = (i) => ({
      me: { accountId: "a1", name: "Mock Tester" },
      people: [{ accountId: "a2", name: "Camille Martin" }].filter((p) =>
        p.name.toLowerCase().includes(String(i.query ?? "").toLowerCase()),
      ),
    });
  });

  const card = () =>
    renderWithData(
      <>
        <CommentsCard testKey="P-1" onOpenInJira={() => {}} />
        <Toaster />
      </>,
    );
  const box = () => screen.getByLabelText("Comment on P-1") as HTMLTextAreaElement;

  it("lists the thread with mentions as chips; only mine can be edited or deleted", async () => {
    card();
    expect(await screen.findByText("Le menu a changé.")).toBeInTheDocument();
    expect(screen.getByText("@Camille Martin")).toBeInTheDocument();
    expect(screen.getByText(/edited/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getByText("you")).toBeInTheDocument();
  });

  it("edits my comment, mention kept", async () => {
    net.routes["issue.editComment"] = (i) => ({ dryRun: false, comment: { ...COMMENTS[1], body: i.text } });
    card();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const edit = screen.getByRole("textbox", { name: "Edit your comment" });
    expect(edit).toHaveValue("@Camille Martin vu.");
    fireEvent.change(edit, { target: { value: "@Camille Martin c'est fait." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(callsOf("issue.editComment")[0]?.input).toEqual({
        key: "P-1",
        id: "2",
        text: "@[Camille Martin](a2) c'est fait.",
      }),
    );
  });

  it("deletes my comment after asking", async () => {
    net.routes["issue.deleteComment"] = () => ({ dryRun: false, id: "2" });
    card();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete this comment?" });
    expect(callsOf("issue.deleteComment")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(callsOf("issue.deleteComment")[0]?.input).toEqual({ key: "P-1", id: "2" }));
  });

  it("mentions someone typed after @, and sends with Ctrl+Enter", async () => {
    net.routes["issue.comment"] = () => ({ dryRun: false, mentions: [{ accountId: "a2", name: "Camille Martin" }] });
    card();
    await screen.findByText("Le menu a changé.");
    fireEvent.change(box(), { target: { value: "Vu avec @ca", selectionStart: 11 } });
    const list = await screen.findByRole("listbox", { name: "Mention someone" });
    expect(within(list).getByRole("option", { name: "Camille Martin" })).toBeInTheDocument();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(box()).toHaveValue("Vu avec @Camille Martin ");
    expect(screen.queryByRole("listbox", { name: "Mention someone" })).toBeNull();
    fireEvent.change(box(), { target: { value: "Vu avec @Camille Martin merci" } });
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(callsOf("issue.comment")[0]?.input).toEqual({ key: "P-1", text: "Vu avec @[Camille Martin](a2) merci" }),
    );
    await waitFor(() => expect(box()).toHaveValue(""));
    expect(await screen.findByText("Jira tells Camille Martin.")).toBeInTheDocument();
  });

  it("keeps the text when Jira refuses, and tries again", async () => {
    net.routes["issue.comment"] = () => {
      throw new Fail("Jira refused a comment on P-1: no permission.");
    };
    card();
    await screen.findByText("Le menu a changé.");
    fireEvent.change(box(), { target: { value: "Bonjour" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(await screen.findByText("Jira refused the comment")).toBeInTheDocument();
    expect(box()).toHaveValue("Bonjour");
    net.routes["issue.comment"] = () => ({ dryRun: false, mentions: [] });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(box()).toHaveValue(""));
    expect(callsOf("issue.comment")).toHaveLength(2);
  });

  it("Claude drafts the comment; the person sends it", async () => {
    net.routes["claude.draftComment"] = () => ({ jobId: "comment-draft-0000abcd" });
    net.routes["jobs.show"] = () => ({
      job: {
        id: "comment-draft-0000abcd",
        kind: "comment-draft",
        status: "done",
        result: { ok: true, text: "@[Camille Martin](a2) d'accord.", mentions: [] },
      },
      events: [],
    });
    card();
    await screen.findByText("Le menu a changé.");
    fireEvent.click(screen.getByRole("button", { name: "Draft with Claude" }));
    const ask = await screen.findByRole("textbox", { name: "What should the comment say" });
    fireEvent.change(ask, { target: { value: "Réponds à Camille" } });
    await act(async () => {
      fireEvent.keyDown(ask, { key: "Enter" });
    });
    await waitFor(() =>
      expect(callsOf("claude.draftComment")[0]?.input).toMatchObject({ key: "P-1", ask: "Réponds à Camille" }),
    );
    await waitFor(() => expect(box()).toHaveValue("@Camille Martin d'accord."));
    expect(screen.getByText("Drafted by Claude")).toBeInTheDocument();
    expect(callsOf("issue.comment")).toHaveLength(0);
    fireEvent.change(box(), { target: { value: "@Camille Martin d'accord, merci." } });
    expect(screen.queryByText("Drafted by Claude")).toBeNull();
  });

  it("says why the thread could not be read", async () => {
    net.routes["issue.comments"] = () => {
      throw new Fail("Jira refused the comments of P-1: no access.");
    };
    card();
    expect(await screen.findByText(/no access/)).toBeInTheDocument();
  });
});
