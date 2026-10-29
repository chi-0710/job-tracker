package com.chi.jobtracker.timeline;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public final class TimelineDtos {

    private TimelineDtos() {
    }

    public record Request(
        @NotNull(message = "进展日期不能为空")
        LocalDate occurredOn,

        @Pattern(
            regexp = "application|screening|writtenTest|firstInterview|secondInterview|finalInterview|offer|other",
            message = "进展类型不合法")
        String stage,

        @Pattern(regexp = "|pending|passed|failed|cancelled", message = "进展结果不合法")
        String result,

        @Size(max = 2000, message = "进展说明不能超过 2000 个字符")
        String note
    ) {
    }

    public record Response(
        UUID id,
        LocalDate occurredOn,
        String stage,
        String result,
        String note,
        Instant createdAt
    ) {

        public static Response from(TimelineEvent event) {
            return new Response(
                event.getId(),
                event.getOccurredOn(),
                event.getStage(),
                event.getResult(),
                event.getNote(),
                event.getCreatedAt()
            );
        }
    }
}
