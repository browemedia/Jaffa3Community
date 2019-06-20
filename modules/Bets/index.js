module.exports = {
  name: 'Bets',
  only: ['twitch'],
  async module (jaffamod) {

    const open = async (bet, message, reply, discord) => {
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
    };

    const close = async (bet, message, reply, discord) => {
      if (bet !== null) {
        jaffamod.store[`${message.userstate['room-id']}-bet`].closed = true;
        reply(`.me Betting closed!`);
      } else {
        reply(`No bet set!`);
      }
    };

    const answer = async (bet, message, reply, discord) => {
      if (bet !== null && bet.closed) {
        let answerArguments = message.arguments.slice(1);
        if (answerArguments.length === 1) { // Simple value
          await simpleAnswer(bet, answerArguments, message, reply, discord);
        } else {
          // TODO: A range possibly?
        }
      } else {
        reply(`No bet set or bet not closed!`);
      }
    };

    const simpleAnswer = async (bet, answerArguments, message, reply, discord) => {
      if (bet.options.length) {
        if (bet.options.includes(answerArguments[0])) {

          //let winners = await jaffamod.db.models.Bet.find({option: answerArguments[0]}).count();
          let aggregate = await jaffamod.db.models.Bet.aggregate([
            {$group: { // Group all bets together and take a grand total = the pot
                _id: null,
                grandTotal: {$sum: "$amount"},
                docs: {$push: {user_id: "$user_id", amount: "$amount", option: "$option"}}}
            },
            {$unwind: "$docs"}, // Reverse the grouping, but now every document has the grandTotal field
            {$match: {"docs.option": answerArguments[0]}}, // Now filter for the answer
            {$group: { // Group all winning bets together and sum for use in the ratio calculation (grandMatchTotal)
                _id: null,
                grandTotal: {$max: "$grandTotal"},
                grandMatchTotal: {$sum: "$docs.amount"},
                docs: {$push: {user_id: "$docs.user_id", amount: "$docs.amount", option: "$docs.option"}}}
            },
            {$unwind: "$docs"}, // Reverse the grouping, but now every document has the grandTotal and grandMatchTotal field
            {$group: {  // Group winning bets by user in case they bet more than once for the winning item
                _id: "$docs.user_id",
                grandTotal: {$max: "$grandTotal"},
                grandMatchTotal: {$max: "$grandMatchTotal"},
                grandUserTotal: {$sum: "$docs.amount"},
                docs: {$push: {user_id: "$docs.user_id", amount: "$docs.amount", option: "$docs.option"}}}
            },
            {$project:{ // Boom easy
                ratio: { $divide: [ "$grandUserTotal", "$grandMatchTotal"] },
                winnings: { $multiply: [ { $divide: [ "$grandUserTotal", "$grandMatchTotal"] }, "$grandTotal" ] }}
            }
          ]).exec();

          if (aggregate.length === 0) {
            reply(`Looks like there were no winners, better luck next time!`);
            return;
          }

          let bulk = [];

          for (let winner of aggregate) {
            bulk.push({
              updateOne: {
                filter: {_id: winner._id},
                update: {$set:{won_a_bet: true}, $inc: {points: Math.round(winner.winnings)}}
              }
            })
          }

          let res = await jaffamod.db.models.User.bulkWrite(bulk);
          reply(`Awarded ${res.modifiedCount} winners!`);

          //jaffamod.db.models.Bet.deleteMany({}).exec(); // Cleanup - TODO: Remove after debugging over
          jaffamod.store[`${message.userstate['room-id']}-bet`] = null; // Cleanup
        } else {
          reply(`Please choose one of the options: ${bet.options.join(', ')}`);
        }
      }
    };


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
          if (amount < 1) return;

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
          await open(bet, message, reply, discord);
          break;
        case 'close': // !betting close
          await close(bet, message, reply, discord);
          break;
        case 'answer': // !betting answer
          await answer(bet, message, reply, discord);
          break;
      }
    });

  }
};
