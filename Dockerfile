FROM node:18-alpine

WORKDIR /usr/src/app

COPY . .

RUN yarn install && yarn build

CMD ["yarn", "start"]
