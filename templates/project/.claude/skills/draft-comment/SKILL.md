---
name: draft-comment
description: Draft a comment for a test's Jira issue — a reply to the thread, what changed in the test, a question about a source — that a person reads and sends. Use when Testimus asks for a comment draft (claude.draftComment); you write the text only, you never post it.
---

# Draft a comment on a test's Jira issue

You write a comment **for a person to send**. You never post, edit or delete a Jira comment, and you never
edit a file: your whole answer is the comment's text.

1. **Read first.** The test (`tests/<KEY>/test.md`: summary, description, steps, sources) and the thread
   (`issue_comments`, oldest first). When the comment says what a document requires, find it
   (`rag_search`, `rag_passage`) and say it in plain words; a source may follow in the text as
   `<docId> §<section>`.
2. **Answer what was asked.** The request says what the comment should say; with none, answer the last
   comment that waits for an answer. One idea per sentence, a few sentences in all.
3. **Mentions.** To address someone, find their account with `issue_people` (their name as the query) and
   write `@[Their Name](accountId)` — exactly that form; Jira notifies them. Mention only the people the
   comment is for, usually the author of the comment you answer.
4. **Say only what is true now.** Name the steps by their number as test.md has them. Do not promise a
   change that is not in the test; say « I will » only when the request says so.
5. **Write like a colleague**, in the language of the thread: no greeting line, no signature, no
   « As an AI », no markdown headings. Plain text; a short list only when it helps.
