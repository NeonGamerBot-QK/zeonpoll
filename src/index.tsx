import "dotenv/config";

import {
  App,
  BlockAction,
  BlockElementAction,
  Option,
  MessageShortcut,
} from "@slack/bolt";
import JSXSlack, { Input, Modal, Section } from "jsx-slack";

import createPollModal from "./modal";
import { checkInput } from "./util";
import { randomDinoFact } from "./dinoFacts";
import { prisma } from "./prisma";
import receiver from "./express";
import { postPoll, refreshPoll, togglePoll } from "./pollUtil";

export const app = new App({
  token: process.env.SLACK_TOKEN,
  receiver,
});

app.command("/denopoll", async ({ client, ack, command }) => {
  await client.conversations
    .info({
      channel: command.channel_id,
    })
    .then(async () => {
      await client.views.open({
        trigger_id: command.trigger_id,
        view: createPollModal(command.channel_id, command.text),
      });
    
      await ack();
    })
    .catch(async (e) => {
      if (e.data?.error === "channel_not_found") {
        await ack({
          text: "This is a private channel - please add this app to it in the channel settings before creating a poll.",
        });
        return;
      }
    });
});

app.command("/denopolls", async ({ ack, respond, command }) => {
  await ack();

  const polls = await prisma.poll.findMany({
    where: {
      createdBy: command.user_id,
      open: true,
    },
  });

  let msg: { text: string; blocks: any } = {
    text: "",
    blocks: undefined,
  };

  if (polls.length === 0) {
    msg.text = "You don't have any open polls.";
  } else {
    msg.text = `You have ${polls.length} open polls: `;
    msg.blocks = [];

    msg.blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: msg.text,
      },
    });
    msg.blocks.push({
      type: "divider",
    });

    polls.sort((a, b) => a.createdOn.getTime() - b.createdOn.getTime());

    for (const poll of polls) {
      msg.blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<https://hackclub.slack.com/archives/${
            poll.channel
          }/p${poll.timestamp?.split(".").join("")}|_${poll.id}_>: *${
            poll.title
          }*`,
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "Close",
            emoji: true,
          },
          value: poll.id.toString(),
          action_id: "togglePoll",
        },
      });
    }
  }

  await respond(msg);
});

app.command("/denopoll-toggle", async ({ ack, command }) => {
  try {
    const toggle = await togglePoll(command.text, command.user_id);
    if (toggle == null) {
      return await ack("poll not found.");
    }

    await ack("success!");
  } catch (e) {
    await ack("something went wrong :cry:");
  }
});

app.action("dinoFact", async ({ ack, body, client }) => {
  await ack();

  await client.chat.postEphemeral({
    channel: body.channel!.id!,
    user: body.user.id,
    text: `:sauropod: Here's a dinosaur fact:\n\n>>> ${randomDinoFact()}`,
  });
});

app.action(/vote:(.+):(.+)/, async ({ action, ack, body }) => {
  await ack();

  const action_id = (action as BlockElementAction).action_id;
  const matches = action_id.match(/vote:(.+):(.+)/);
  if (!matches) {
    return;
  }

  const [, pollId, optionId] = matches;

  const poll = await prisma.poll.findUnique({
    where: { id: parseInt(pollId) },
    include: {
      options: true,
    },
  });

  if (!poll || !poll.open) {
    return;
  }

  if (poll.multipleVotes) {
    // the poll allows for multiple votes

    // check to see if the user's already voted for this option
    const userVote = await prisma.vote.findUnique({
      where: {
        user_optionId: { user: body.user.id, optionId: parseInt(optionId) },
      },
      include: { option: true },
    });

    if (userVote) {
      await prisma.vote.delete({
        where: { id: userVote.id },
      });
      await refreshPoll(parseInt(pollId));
      return;
    }
  } else {
    // the poll only allows 1 vote

    // Check to see if the user's already voted
    const userVote = await prisma.vote.findFirst({
      where: {
        user: body.user.id,
        pollId: parseInt(pollId),
      },
      include: {
        option: true,
      },
    });

    if (userVote) {
      // They've already voted
      await prisma.vote.delete({
        where: { id: userVote.id },
      });

      // Are they voting for the same option? if so, don't switch their vote
      if (userVote.option.id === parseInt(optionId)) {
        await refreshPoll(parseInt(pollId));
        return;
      }
    }
  }

  // We've reached the end, so VOTE!!!
  await prisma.vote.create({
    data: {
      user: body.user.id,
      optionId: parseInt(optionId),
      pollId: poll.id,
    },
  });

  // Refresh the poll
  await refreshPoll(parseInt(pollId));
});

app.action(/addOption:(.+)/, async ({ ack, action, client, ...args }) => {
  await ack();

  const { trigger_id } = args.body as BlockAction;

  const action_id = (action as BlockElementAction).action_id;
  const matches = action_id.match(/addOption:(.+)/);
  if (!matches) {
    return;
  }

  const [, pollId] = matches;

  const poll = await prisma.poll.findUnique({
    where: {
      id: parseInt(pollId),
    },
  });

  if (!poll || !poll.open || !poll.othersCanAdd) {
    return;
  }

  await client.views.open({
    trigger_id,
    view: JSXSlack(
      <Modal title="Add Option" callbackId="addOption">
        <Section>
          Add an option to <b>{poll.title}</b>
        </Section>

        <Input label="Option" id="option" name="option" required />
        <Input type="hidden" name="poll" value={pollId} />

        <Input type="submit" value="Add" />
      </Modal>,
    ),
  });
});

app.action("modalAddOption", async ({ ack, client, ...args }) => {
  await ack();

  const body = args.body as BlockAction;

  const { channel, optionCount } = JSON.parse(
    body.view?.private_metadata as string,
  );

  client.views.update({
    view_id: body.view?.id,
    view: createPollModal(channel, "", optionCount + 1),
  });
});

app.action("togglePoll", async ({ ack, client, respond, ...args }) => {
  await ack();

  const body = args.body as BlockAction;

  // @ts-ignore
  const poll = body.actions[0].value;

  try {
    const toggle = await togglePoll(poll, body.user.id);
    if (toggle === null) {
      return await respond("poll not found.");
    }

    respond("success!");
  } catch (e) {
    respond("something went wrong :cry:");
  }
});

app.shortcut("message-toggle", async ({ ack, client, ...args }) => {
  await ack();

  const shortcut = args.body as MessageShortcut;

  const result = await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: {
      callback_id: "message-toggle",
      private_metadata: JSON.stringify({
        messageId: shortcut.message.ts,
      }),
      type: "modal",
      title: {
        type: "plain_text",
        text: "My App",
        emoji: true,
      },
      submit: {
        type: "plain_text",
        text: "Submit",
      },
      close: {
        type: "plain_text",
        text: "Cancel",
      },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Are you sure you want to toggle this poll?",
          },
        },
      ],
    },
  });
});

app.view("create", async ({ ack, body, view }) => {
  const values = view.state.values;
  const othersCanAdd = values.options.options.selected_options!.some(
    (v: Option) => v.value === "othersCanAdd",
  );

  const opts = Object.entries(values)
    .filter(([key]) => /option(\d+)/.test(key))
    .map(([key, value]) => value[key].value)
    .filter((i): i is string => !!i);

  if (opts.length < 2 && !othersCanAdd) {
    await ack({
      response_action: "errors",
      errors: {
        option1:
          'You need at least 2 options to create a poll, unless "Let others add options" is checked',
      },
    });
    return;
  }

  if (!checkInput(values.title.title.value!)) {
    await ack({
      response_action: "errors",
      errors: {
        title:
          "You are not in the sudoers file. This incident will be reported.",
      },
    });
    return;
  }

  const invalidOpts = opts.filter((opt) => !checkInput(opt));

  if (invalidOpts.length !== 0) {
    await ack({
      response_action: "errors",
      errors: invalidOpts.reduce<Record<`option${number}`, string>>(
        (acc, _curr, idx) => {
          acc[`option${idx + 1}`] =
            "You are not in the sudoers file. This incident will be reported.";
          return acc;
        },
        {},
      ),
    });

    return;
  }

  await ack();

  const poll = await prisma.poll.create({
    data: {
      createdBy: body.user.id,
      title: values.title.title.value!,
      anonymous: values.options.options.selected_options?.some(
        (v) => v.value === "anonymous",
      ),
      multipleVotes: values.options.options.selected_options?.some(
        (v) => v.value === "multipleVotes",
      ),
      othersCanAdd,
      channel: JSON.parse(view.private_metadata).channel,
      options: {
        createMany: {
          data: opts.map((name) => ({ name })),
        },
      },
    },
  });

  try {
    await postPoll(poll);
  } catch (e) {
    console.error(`Error when posting poll: ${e}`);
    return;
  }
});

app.view("addOption", async ({ view, body, ack }) => {
  const pollId = JSON.parse(view.private_metadata).poll;
  const optionName = view.state.values.option.option.value!;

  if (!checkInput(optionName)) {
    await ack({
      response_action: "errors",
      errors: {
        option:
          "You are not in the sudoers file. This incident will be reported.",
      },
    });
    return;
  }

  await ack();

  const poll = await prisma.poll.findUnique({
    where: {
      id: parseInt(pollId),
    },
  });

  if (!poll || !poll.open || !poll.othersCanAdd) {
    return;
  }

  await prisma.pollOption.create({
    data: {
      name: optionName,
      pollId: poll.id,
      createdBy: body.user.id,
    },
  });

  await refreshPoll(poll.id);
});

app.view("message-toggle", async ({ ack, body, view }) => {
  await ack();

  const messageId = JSON.parse(view.private_metadata).messageId;

  const poll = await prisma.poll.findFirst({
    where: {
      timestamp: messageId,
    },
  });

  if (!poll) {
    return;
  }

  await togglePoll(poll.id.toString(), body.user.id);
});

async function main() {
  await app.start(parseInt(process.env.PORT as string) || 3000);
  console.log("App started");
}

main();
