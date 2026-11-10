---
name: draft-comment
description: Draft a comment for a test's Jira issue — a reply to the thread, what changed in the test, a question about a source — that a person reads and sends. Use when Testimus asks for a comment draft (claude.draftComment); you write the text only, you never post it.
---

# Draft a comment on a test's Jira issue

You write a comment for a person to send. You never post, edit or delete a Jira comment and you
edit no file: your whole reply is the comment's text.

1. **Read first**, in one turn: the test (`tests_show <KEY>`) and the thread (`issue_comments`,
   oldest first). When the comment says what a document requires, find it (`rag_search`,
   `rag_passage`) and say it in plain words; a source may follow as `<docId> §<section>`.
2. **Answer what was asked.** The request says what the comment should say; with none, answer the
   last comment that waits for an answer. One idea per sentence, a few sentences in all.
3. **Mentions.** Find the person with `issue_people` (their name as the query) and write
   `@[Their Name](accountId)`, exactly that form: Jira notifies them. Mention only who the comment
   is for, usually the author of the comment you answer.
4. **Say only what is true now.** Name the steps by their number in `test.md`. Promise no change
   that is not in the test; « I will » only when the request says so.
5. **Write like a colleague**, in the language of the thread: no greeting line, no signature, no
   headings. Plain text; a short list only when it helps.
