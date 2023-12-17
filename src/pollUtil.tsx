import { Poll } from "@prisma/client";
import JSXSlack, {
  Blocks,
  Button,
  Context,
  Input,
  Modal,
  Section,
} from "jsx-slack";

import { prisma, PollWithOptions } from "./prisma";
import message from "./message";
import { app } from "./index";

export async function refreshPoll(pollId: number) {
  const poll = await getPoll(pollId);
  if (!poll) return;

  await app.client.chat.update({
    token: process.env.SLACK_TOKEN,
    text: "This message can't be displayed in your client.",
    blocks: message(poll),
    ts: poll.timestamp!,
    channel: poll.channel,
  });
}

export async function postPoll(poll: Poll): Promise<Poll> {
  const resp = await app.client.chat.postMessage({
    blocks: message(await getPoll(poll.id)),
    text: "This message can't be displayed in your client.",
    channel: poll.channel,
    token: process.env.SLACK_TOKEN,
  });

  poll = await prisma.poll.update({
    where: {
      id: poll.id,
    },
    data: {
      timestamp: resp.message?.ts,
    },
  });

  if (poll.createdBy) {
    await app.client.chat.postEphemeral({
      text: `Poll successfully created! Run \`/denopoll-toggle ${poll.id}\` to close the poll once you're done.`,
      blocks: JSXSlack(
        <Blocks>
          <Section>
            Poll successfully created! Run{" "}
            <code>/denopoll-toggle {poll.id}</code> to close the poll once
            you're done.
            <Button actionId="dinoFact">:sauropod:</Button>
          </Section>
          <Context>
            :information_source: Remember to save your poll's ID (
            <code>{poll.id}</code>) if you'd like to close it later.
          </Context>
        </Blocks>,
      ),
      channel: poll.channel,
      user: poll.createdBy,
      token: process.env.SLACK_TOKEN,
    });
  }

  return poll;
}

export async function getPoll(id: number): Promise<PollWithOptions> {
  const poll = await prisma.poll.findUnique({
    where: {
      id,
    },
    include: {
      options: {
        orderBy: { id: "asc" },
        include: { votes: { orderBy: { createdOn: "asc" } } },
      },
      _count: { select: { votes: true } },
    },
  });

  return poll!;
}

export async function togglePoll(id: string, user: string) {
  try {
    const poll = await prisma.poll.findFirst({
      where: {
        id: parseInt(id),
        createdBy: user,
      },
    });

    if (!poll) {
      return null;
    }

    await prisma.poll.update({
      where: {
        id: poll.id,
      },
      data: {
        open: !poll.open,
      },
    });

    await refreshPoll(poll.id);
    return poll;
  } catch (e) {
    throw e;
  }
}
