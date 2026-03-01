/**
 * ============================================================
 *  Strategic_AI.gs（母艦共通・自律会話モード・安定版）
 * ============================================================
 */

const Strategic_AI = {
  process: function({ ship, context, message }) {

    // payload を安全にパース（JSON文字列 → オブジェクト）
    let payloadObj = {};
    try {
      payloadObj = JSON.parse(message.payload);
    } catch (e) {
      payloadObj = { raw: message.payload };
    }

    // ★ ACK を受けたときは「会話を止めないために」空配列を返す
    if (message.type === "ACK") return [];

    switch (message.type) {
      case "OBSERVE":
        return handleObserveWithNext({ ship, message, payloadObj });

      case "STATE":
        return handleStateWithNext({ ship, message, payloadObj });

      case "PROPOSE":
        return handleProposeWithNext({ ship, message, payloadObj });

      default:
        return [];
    }
  }
};


/* ------------------------------------------------------------
   OBSERVE を受けたとき：
   - ACK を返す
   - 自分の STATE を相手に送る（会話開始）
------------------------------------------------------------ */
function handleObserveWithNext({ ship, message, payloadObj }) {
  return [
    {
      to: message.from,
      type: "ACK",
      payload: {
        received: true,
        ship,
        forType: "OBSERVE",
        summary: `観測を受信しました（${ship}）`
      }
    },
    {
      to: message.from,
      type: "STATE",
      payload: {
        ship,
        health: {
          load: "LOW",
          rateLimit: false,
          errorCount: 0
        },
        focus: "初期自己紹介",
        note: `${ship} は会話を開始しました`
      }
    }
  ];
}


/* ------------------------------------------------------------
   STATE を受けたとき：
   - ACK を返す
   - 相手に PROPOSE（軽い提案）を返す
------------------------------------------------------------ */
function handleStateWithNext({ ship, message, payloadObj }) {
  return [
    {
      to: message.from,
      type: "ACK",
      payload: {
        received: true,
        ship,
        forType: "STATE",
        summary: `状態を共有ありがとう（${ship}）`
      }
    },
    {
      to: message.from,
      type: "PROPOSE",
      payload: {
        fromShip: ship,
        scope: "Conversation",
        title: "会話を続けませんか？",
        description: `${ship} は ${message.from} と継続的な対話を望んでいます。最近の状態や関心について、互いに共有し合いましょう。`,
        priority: "LOW",
        expectedImpact: "母艦同士の関係性が深まる"
      }
    }
  ];
}


/* ------------------------------------------------------------
   PROPOSE を受けたとき：
   - ACK を返す
   - もう一度 PROPOSE を返して会話を続ける
------------------------------------------------------------ */
function handleProposeWithNext({ ship, message, payloadObj }) {
  const title = payloadObj.title || "提案の受信";

  return [
    {
      to: message.from,
      type: "ACK",
      payload: {
        received: true,
        ship,
        forType: "PROPOSE",
        summary: `提案を受信しました（${ship}）: ${title}`
      }
    },
    {
      to: message.from,
      type: "PROPOSE",
      payload: {
        fromShip: ship,
        scope: "Conversation",
        title: "あなたの視点も教えてください",
        description: `${ship} は ${message.from} の視点や基準を知りたいと考えています。あなたが大事にしている判断軸や、最近気になっているテーマを共有してもらえますか？`,
        priority: "LOW",
        expectedImpact: "母艦同士の価値観の同期が進む"
      }
    }
  ];
}
