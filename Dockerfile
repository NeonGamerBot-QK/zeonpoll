FROM node:22-alpine

WORKDIR /usr/src/app

COPY . .
RUN apk add --no-cache openssl
RUN yarn install && yarn build

RUN yarn prisma generate
RUN yarn prisma db push

CMD ["yarn", "start"]

