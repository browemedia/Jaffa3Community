module.exports = {
  name: 'Bets',
  only: ['twitch'],
  async module (jaffamod) {

    jaffamod.registerCommand('bet', async (message, reply, discord) => {
      jaffamod.client.deletemessage(message.channel, message.userstate['id']).catch(console.error); // Delete their message
      if (message.arguments.length === 2) {
        let bet = jaffamod.store[`${message.userstate['room-id']}-bet`] || null;
        if (bet !== null && !bet.closed) {
          if (bet.options && !bet.options.includes(message.arguments[0])) {
            reply(`.me @${message.userstate.username} Please choose one of the options: ${bet.options.join(', ')}`);
            return;
          }
          if (isNaN(message.arguments[1])) {
            reply(`.me @${message.userstate.username} Your bet amount has to be a number`);
            return;
          }

          const amount = parseInt(message.arguments[1]);

          let user = await jaffamod.db.models.User.findOne({_id: message.userstate['user-id']}).exec();
          if (user === null) return;

          if (user.points < amount) {
            reply(`.me @${message.userstate.username} Not enough funds`);
            return;
          }

          user.points -= amount;
          await user.save();

          let betDocument = new jaffamod.db.models.Bet({
            channel_id: message.userstate['room-id'],
            user_id: message.userstate['user-id'],
            option: message.arguments[0],
            amount
          });
          await betDocument.save();
        }
      } else {
        let bet = jaffamod.store[`${message.userstate['room-id']}-bet`] || null;
        if (bet !== null && !bet.closed) {
          reply(`.me @${message.userstate.username} To bet: !bet ${bet.options.length ? '<option>' : '<guess>'} <amount>`)
        } else {
          // Bets not open - reduce spam esp. just after a close people will still try to bet.
        }
      }
    });

    jaffamod.registerCommand('betting', async (message, reply, discord) => {
      if (!jaffamod.determineModerator(message, discord)) return;

      let bet = jaffamod.store[`${message.userstate['room-id']}-bet`] || null;

      switch(message.arguments[0]) {
        case 'open': // !betting open
          if (bet === null) {
            jaffamod.store[`${message.userstate['room-id']}-bet`] = bet = {
              question: message.arguments[1],
              options: message.arguments.slice(2),
              closed: false,
              answer: null
            };

            reply(`.me New bet! ${bet.question}`);
            if (bet.options.length) {
              reply(`.me Options: ${bet.options.join(', ')}`);
            }
            reply(`.me To bet: !bet ${bet.options.length ? '<option>' : '<guess>'} <amount> - Note: your message will be deleted to reduce spam but it will be counted!`);
          } else {
            reply(`Bet already set!`);
          }
          break;
        case 'close': // !betting close
          if (bet !== null) {
            jaffamod.store[`${message.userstate['room-id']}-bet`].closed = true;
            reply(`.me Betting closed!`);
          } else {
            reply(`No bet set!`);
          }
          break;
        case 'answer': // !betting answer
          if (bet !== null && bet.closed) {
            let answerArguments = message.arguments.slice(1);
            if (answerArguments.length === 1) { // Simple value
              if (bet.options.length) {
                if (bet.options.includes(answerArguments[0])) {

                  let winners = await jaffamod.db.models.Bet.find({option: answerArguments[0]}).exec();
                  let pool = await jaffamod.db.models.Bet.aggregate([
                    {
                      $group:
                        {
                          _id: null,
                          amount: { $sum: "$amount" }
                        }
                    }
                  ]).exec();

                  let poolEach = Math.round(pool[0].amount / winners.length);

                  let res = await jaffamod.db.models.User.updateMany({_id: {$in: winners.map(i => i.user_id)} }, {$inc: {points: poolEach}}).exec();
                  reply(`Awarded ${poolEach} to ${res.nModified} winners!`);

                  jaffamod.db.models.Bet.deleteMany({}).exec(); // Cleanup
                  jaffamod.store[`${message.userstate['room-id']}-bet`] = null; // Cleanup
                } else {
                  reply(`Please choose one of the options: ${bet.options.join(', ')}`);
                }
              }
            } else {
              // TODO: A range possibly?
            }
          } else {
            reply(`No bet set or bet not closed!`);
          }
          break;
      }

    });

  }
};
