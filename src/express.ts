import express from "express";
import { ExpressReceiver } from "@slack/bolt";

import { prisma } from "./prisma";
import { postPoll, refreshPoll } from "./pollUtil";

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET as string,
});

receiver.router.post("/create", express.json(), async (req, res) => {
  try {
    const { title, options, channel, othersCanAdd, multipleVotes } = req.body;
    const tok = req.headers.authorization?.slice("Bearer ".length);
    if (!tok) {
      throw new Error("no token provided");
    }

    const token = await prisma.token.findUnique({ where: { token: tok } });
    if (token === null) {
      throw new Error("invalid token");
    }

    const poll = await prisma.poll.create({
      data: {
        title,
        options: {
          //@ts-ignore 
          createMany: {
            data: options.map((i: string) => ({
              name: i,
            })),
          },
        },
        channel,
        othersCanAdd,
        multipleVotes,
        createdBy: token.user,
      },
      include: { options: { select: { id: true, name: true } } },
    });

    let timestamp;
    try {
      const p = await postPoll(poll);
      timestamp = p.timestamp;
    } catch (e) {
      console.error(`Error when posting poll: ${e}`);
      return;
    }
    poll.timestamp = timestamp;

    res.json({
      ok: true,
      message: "woop woop you did it",
      poll,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      err: (err as Error).message,
    });
  }
});

receiver.router.post("/toggle/:id", express.json(), async (req, res) => {
  try {
    const tok = req.headers.authorization?.slice("Bearer ".length);
    if (!tok) {
      throw new Error("no token provided");
    }

    const token = await prisma.token.findUnique({ where: { token: tok } });
    if (token === null) {
      throw new Error("invalid token");
    }

    // Find poll
    const poll = await prisma.poll.findUnique({
      where: {
        id: parseInt(req.params.id),
      },
    });
    if (!poll) {
      throw new Error("can't find poll");
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

    res.json({
      ok: true,
      message: "woop woop you did it",
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      err: (err as Error).message,
    });
  }
});

export default receiver;
