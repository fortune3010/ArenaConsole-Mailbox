package com.gamearena.data

import com.google.gson.annotations.SerializedName

/**
 * DTOs para o Bloco 3.D (Histórico + Ranking).
 */

data class MatchHistoryDto(
    val id: String,
    @SerializedName("gameId") val gameId: String,
    @SerializedName("gameName") val gameName: String?,
    @SerializedName("gameCover") val gameCover: String?,
    val result: String?,       // "win" | "loss" | "draw" | null
    val mode: String?,         // "multiplayer" | "singleplayer" | "tournament" | null
    val opponents: Int,
    @SerializedName("roomCode") val roomCode: String?,
    @SerializedName("opponentId") val opponentId: String?,
    @SerializedName("playedAt") val playedAt: String?,
    // GA16_HISTORY_CARD: já devolvidos por GET /api/history/me (GA16_HISTORY)
    @SerializedName("opponentName") val opponentName: String? = null,
    @SerializedName("opponentAvatar") val opponentAvatar: String? = null,
    @SerializedName("myName") val myName: String? = null,
    @SerializedName("myAvatar") val myAvatar: String? = null,
    // GA16_HISTORY_CARD: placar — o backend ainda NÃO envia (Fase 18). null → o card esconde o placar.
    @SerializedName("myScore") val myScore: Int? = null,
    @SerializedName("opponentScore") val opponentScore: Int? = null
) {
    val isWin: Boolean get() = result == "win"
    val isLoss: Boolean get() = result == "loss"
    val isDraw: Boolean get() = result == "draw"
    val hasResult: Boolean get() = result != null
    val hasScore: Boolean get() = myScore != null && opponentScore != null
}

data class HistoryResponse(
    val history: List<MatchHistoryDto>?,
    val total: Int?
)

data class RankingRowDto(
    val position: Int,
    @SerializedName("userId") val userId: String,
    val username: String,
    val level: Int,
    @SerializedName("totalMatches") val totalMatches: Int,
    val wins: Int,
    val losses: Int,
    val trophies: Int
)

data class RankingResponse(
    val ranking: List<RankingRowDto>?,
    val total: Int?
)
