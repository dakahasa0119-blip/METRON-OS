/**
 * 👻 幽霊リスト自動セットアップ (v1.0)
 * 行番号を正しく特定してステータス更新を行う修正版
 */
function setupGhostList() {
  // ▼▼▼ 先ほどのデータをここに格納済みです ▼▼▼
  const CSV_DATA = `ScriptID,Name
1h6236hiXNA1lqahnp0BKDsnD-yGKDaAZTY6Trvq5bBc,スプレッドシートを開く
1NgiXiw_WzkJdVHMwulPJwPdxXq4Nx0PwuMvcLr8u4GM,スプレッドシートを開く
1Md0-AsJ-ZmY9pt_ClhXHPGBU_DgsAT7cOfAON6ZWwDM,スプレッドシートを開く
1hIlLbml9Cm46XGCMwtUgQNHaQz6L707yag-0C_kfZ68,スプレッドシートを開く
1AsFqxESlNSgGoMnTZBAxoJE-KAzkrg8I-RcxgNv7A_4,スプレッドシートを開く
1JYfK3TyxqexpFj0-a30cOY20W76I3O1DospcAPSuxeU,スプレッドシートを開く
1573Jb5XBJCwQKiYvkExfzUe90cXMi1WphehtLFxt2Jg,スプレッドシートを開く
1WFGTRaRvfgm0dMloq3qCYnHXPdSgkudAE7lyNPQiPt8,スプレッドシートを開く
15Z8V3BPG3vwvsOtR7-MKa3Vy2OE3lnqQusl_3kAxCwc,スプレッドシートを開く
16U8qLzaHNqn3n1MQj3wMizdI_vjhqctjOikD6orOr0E,スプレッドシートを開く
1fc6I3zDI9R_sTIG-yHuRfvQlsH3ozcnjDIt2MlJr1BA,スプレッドシートを開く
1qEX0d2LWg6coTFAsDAQ_Cl1K70FSq8fYBJg5rPGeXC4,スプレッドシートを開く
1ppL0c12Pcwern6J0_0EvMt-p7lgodlFRvRTnkDeru7w,スプレッドシートを開く
1EROVh_ev_v7ljBmN8vZjzX0TyaVFmW4zJbm2Q69DI4k,スプレッドシートを開く
1iO4RZaIXJkXas6gc3n9dVczk2c5iS7ncWYijVB4vCuI,スプレッドシートを開く
1F0_Z_ZlnTLSLJGEA9wPMZB-t2LBGLiS9WhqJZOFN3pU,スプレッドシートを開く
1mht8AK6qIOZCwrf-_Qth7YKUv0QMOfuCLC5wohHQvf0,スプレッドシートを開く
1LUVV-LGmoFSkXy3fQZcOpJhUatGyUlBQGAvtaeQE-vE,スプレッドシートを開く
1X5qS-vplScCe7pnixaRG4IqNTPnfmiBy95XKasfeKBU,スプレッドシートを開く
1yrNVxzVUmJyPqGhg85aFhmEdffFe7m8gE0Jma-LcAKc,スプレッドシートを開く
1Ne6bgsUzL_jl20lTvsxgIk1o1wduuGtkL76cBvdlOYg,スプレッドシートを開く
10grmDaBuZX0ePJLTgaivMZKoSUcUCgndue9RydDyh8M,スプレッドシートを開く
1C-KZyUN9XqBL1lF2rS0hLNfKBLNFYWh9ylODhY_Bfcg,スプレッドシートを開く
1BhitjqmWI9f3nGz_HS-BzLrsZs0WYT6L2IeHX3JMt4g,スプレッドシートを開く
1raR_qzdrF4pegaFHkq394E8dN0L56NCzzuK1XP18lZ0,スプレッドシートを開く
10yk3cw0jurWiaJA3i_nC6FXxD_u3Zn10pUMYkcl3LWw,スプレッドシートを開く
1dNunRzUn5TpIIwkMEoAWZFmT28qmDUQuAVwxEtQCeBA,スプレッドシートを開く
1uizBDPZvvMQWb5Q1jsPvW54Sf6mVYWNznqvebj2QGtA,スプレッドシートを開く
1gYkqIwEEP5XJl1vecfyj_YMGg4PSLwVynlNqEgwA2ss,スプレッドシートを開く
1EwFYKZYTqXgbtxL_M82Jxx5Ox0u2vRtpJ6eK_oIsT0c,スプレッドシートを開く
18tfpAh6lVTPzu0w6sgzniL-2e_gyLKn7pHpOQnEq9aU,スプレッドシートを開く
1AjhxNI7OOKOQFPBxBMb6CD4a1fie5wx_fQR5nied8Go,スプレッドシートを開く
1nI7OfUiAfXj1bG9VM4wXxhGtw5sDDroiBzyfwSSF5Zw,スプレッドシートを開く
1_A21cq7H7vi1NCsP3T3hBvmBOgm8PIWcxEquuziYUck,スプレッドシートを開く
1a6SQYZ8vfCUH4iDmdt-qS1pX2uAgKWAijS37iTiE1Q8,スプレッドシートを開く
1b-f6U38-zSdibgk7N3KhkmNr2Iv_Ww0XUjuVj6aLkY4,スプレッドシートを開く
1oVejZBSTQALMb0zwJLTXEnDeNEn_Kpx4izKvrtD8Vpg,スプレッドシートを開く
1A4lJZMjq_nQ1Z8rAylVD8h3mTPh6b5ljqtk-cRJ2ZuY,スプレッドシートを開く
1bNwOMBxooKjZkfgOPdCS2tT6UzBKAIzix8icVnDIVho,スプレッドシートを開く
1JKfjKc3XXKHldstAw5fpbtbocTfpZmuk65B-Xrmsuys,スプレッドシートを開く
1mQR3U7o3GwjwOMgWV9-ecOSofujYNE7yIIbJOqwjWX0,スプレッドシートを開く
1ITF9-hz9wqOWZ7hrps3HFR4hMX09gJShEqQHxDRPIck,スプレッドシートを開く
1gvu-my_SBMV7Z_5lLxSyfdSe_VstfAxB6K7I0edwlkc,スプレッドシートを開く
1IPtypf-Lg-TtURWRty7JB2TW_laZ7DptimalsZaz_mI,スプレッドシートを開く
1VoLNKrEkNpCECKFm9xeiy_7E2u2IhPT98Qt8t2mr-0M,スプレッドシートを開く
1jsyLRkl8IksXyIWb5pFE5rhDUIwunhSPXC24tP7phe4,スプレッドシートを開く
1WHSo1vyNczNhGRh2wcy2951LWkrRZE0mTcTs_93kKUc,スプレッドシートを開く
1ZXN0k1sxGg8nsPfv5BG2r8XLK9xu8pnuL8x95Ejd6Ys,スプレッドシートを開く
1VinW_0uy0ZpPpK4WL6qgt09fhIfrKrO1HrBRK-VXFts,スプレッドシートを開く
1PeZxy_PoppHqLuLicFcueLK8ZZ-mkN5XbcIhcUivgok,スプレッドシートを開く
1qCsEAoozvwXwCoukGdaIowEzpfHEmIcywq9ruQKGrBM,スプレッドシートを開く
11FRHhQfIN14lxoQopJ-zp7HhWn3NJOzlZe6gchqfliA,スプレッドシートを開く
1fpm1G0BVvJWqD98_NzYb__6UFAlmPvey0aqqfKLrBn0,スプレッドシートを開く
1DqEKua_OlQkXr1vPNdKh5WBsMis2qPJGdf5Xx_4nTFY,スプレッドシートを開く
1pXA9xBSwhX52T7LsAj4qyxMt3y8ld_wsuyanHN2Ogt0,スプレッドシートを開く
12ZEI3OzVQdoL83uLkBrJwXL07kV1htGLj8Ew0Ov8g_A,スプレッドシートを開く
15_akiOQJlOc0F7YUb71IphSZCrtbXgSqMYWX0G1N_7U,スプレッドシートを開く
16AQ8FuRNp-2i4eYqk923mGXn7R0kuXOWBKFF0FotMl8,スプレッドシートを開く
1E1_22SDCt72fwv4gsm_7IydJ0-BOrtPQBPJVeoghg0w,スプレッドシートを開く
1gndFi8iEG1ybMu5Qwq1d2v3qe8Ue1ucYpz8baaRdEjE,スプレッドシートを開く
1-VHe-OitMfwszOU5B9dPOYpJLVaD6pVfC1lGj3yRwlA,スプレッドシートを開く
1favWABsPmsWt4r9ygFFaqezuwUFvN58s3ETBbqa-v6M,スプレッドシートを開く`;

  // 1. ユニバース取得（現在のスプレッドシートを特定）
  const universe = BAKU.getUniverse_();
  if (!universe.registry) return console.error("エラー: スプレッドシートが見つかりません。");
  const ss = SpreadsheetApp.openById(universe.registry);

  // 2. シート作成（既にある場合はクリアして再利用）
  let sheet = ss.getSheetByName("BAKU_GHOST_LIST");
  if (sheet) {
    sheet.clear();
    console.log("既存の BAKU_GHOST_LIST をクリアしました。");
  } else {
    sheet = ss.insertSheet("BAKU_GHOST_LIST");
    console.log("新規 BAKU_GHOST_LIST を作成しました。");
  }

  // 3. データ整形と流し込み
  const rows = CSV_DATA.trim().split('\n').map(line => line.split(','));
  
  // A1セルから一気に書き込み
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  
  // 4. 見た目を整える（オマケ）
  sheet.getRange(1, 1, 1, 3).setBackground("#4a86e8").setFontColor("white").setFontWeight("bold");
  sheet.getRange("C1").setValue("STATUS"); // C列をステータス用に
  sheet.setColumnWidth(1, 350); // ID列を広げる

  console.log(`✅ 完了: ${rows.length - 1} 件のIDをセットしました。runGhostHunt を実行してください。`);
}