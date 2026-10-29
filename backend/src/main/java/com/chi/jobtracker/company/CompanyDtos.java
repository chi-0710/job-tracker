package com.chi.jobtracker.company;

import com.chi.jobtracker.position.PositionDtos;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class CompanyDtos {

    private CompanyDtos() {
    }

    public record Request(
        @NotBlank(message = "公司名称不能为空")
        @Size(max = 200, message = "公司名称不能超过 200 个字符")
        String name,

        @Size(max = 200, message = "地点不能超过 200 个字符")
        String location,

        @Pattern(regexp = "private|state|", message = "企业性质不合法")
        String companyType,

        @Size(max = 2000, message = "公司备注不能超过 2000 个字符")
        String note
    ) {
    }

    public record Response(
        UUID id,
        String name,
        String location,
        String companyType,
        String note,
        List<PositionDtos.Response> positions,
        Instant createdAt,
        Instant updatedAt
    ) {

        public static Response from(Company company, List<PositionDtos.Response> positions) {
            return new Response(
                company.getId(),
                company.getName(),
                company.getLocation(),
                company.getCompanyType(),
                company.getNote(),
                positions,
                company.getCreatedAt(),
                company.getUpdatedAt()
            );
        }
    }
}
