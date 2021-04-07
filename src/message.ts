import { Block, KnownBlock } from "@slack/bolt";
import Poll from "./models/Poll";
import PollOption from "./models/PollOption";

function buildProgressBar(progress: number, maxLength: number): string {
  const numElements = maxLength * progress;

  if (numElements == 0) {
    return "";
  }

  let bar = "\n`";

  for (let i = 0; i < maxLength; i++) {
    if (i < numElements) {
      bar += "█";
    } else {
      bar += " ";
    }
  }

  bar += "`";

  return bar;
}

export default (poll: Poll): (Block | KnownBlock)[] => {
  let mostVotes: null | PollOption = poll.options.reduce((acc, curr) => {
    if (curr.votes.length > acc.votes.length) {
      return curr;
    } else {
      return acc;
    }
  });

  if (mostVotes.votes.length == 0) {
    mostVotes = null;
  }

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:${poll.open ? "clipboard" : "lock"}: *${poll.title}*${
          poll.anonymous ? " (responses are anonymous)" : ""
        }${poll.multipleVotes ? " (you may vote for multiple options)" : ""}`,
      },
    },
    ...poll.options.map((opt): Block | KnownBlock => {
      let percentage = Math.round((opt.votes.length / poll.votes.length) * 100);
      if (isNaN(percentage)) {
        percentage = 0;
      }

      return {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${
            opt == mostVotes && !poll.open ? ":white_check_mark: " : ""
          }${opt.name} _(${opt.votes.length} vote${
            opt.votes.length == 1 ? "" : "s"
          }, *${percentage}%*)_${
            !poll.anonymous
              ? "\n" + opt.votes.map((i) => "<@" + i.user + ">").join(", ")
              : ""
          }${buildProgressBar(percentage / 100, 30)}`,
        },
        ...(poll.open
          ? {
              accessory: {
                type: "button",
                action_id: `vote:${poll.id}:${opt.id}`,
                text: {
                  type: "plain_text",
                  text: "Vote",
                },
              },
            }
          : {}),
      };
    }),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Created by <@${poll.createdBy}> with \`/dinopoll\``,
        },
      ],
    },
  ];
};
