package com.chi.jobtracker.position;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public final class PositionDtos {

    private PositionDtos() {
    }

    public record Request(
        @NotBlank(message = "岗位名称不能为空")
        @Size(max = 200, message = "岗位名称不能超过 200 个字符")
        String title,

        @Size(max = 100, message = "薪资不能超过 100 个字符")
        String salary,

        @Size(max = 100, message = "投递渠道不能超过 100 个字符")
        String channel,

        LocalDate appliedOn,

        @Pattern(regexp = "pending|applied|interviewing|offer|rejected|failed", message = "岗位状态不合法")
        String status,

        @Size(max = 10000, message = "岗位备注不能超过 10000 个字符")
        String note,

        @Size(max = 10000, message = "面试准备不能超过 10000 个字符")
        String interviewPrep,

        @Size(max = 10000, message = "经验总结不能超过 10000 个字符")
        String experienceSummary
    ) {
    }

    public record Response(
        UUID id,
        UUID companyId,
        String title,
        String salary,
        String channel,
        LocalDate appliedOn,
        String status,
        String note,
        String interviewPrep,
        String experienceSummary,
        Instant createdAt,
        Instant updatedAt
    ) {

        public static Response from(Position position) {
            return new Response(
                position.getId(),
                position.getCompanyId(),
                position.getTitle(),
                position.getSalary(),
                position.getChannel(),
                position.getAppliedOn(),
                position.getStatus(),
                position.getNote(),
                position.getInterviewPrep(),
                position.getExperienceSummary(),
                position.getCreatedAt(),
                position.getUpdatedAt()
            );
        }
    }
}
