package com.chi.jobtracker.company;

import com.chi.jobtracker.common.ApiException;
import com.chi.jobtracker.position.PositionDtos;
import com.chi.jobtracker.position.PositionRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CompanyService {

    private final CompanyRepository companyRepository;
    private final PositionRepository positionRepository;

    public CompanyService(CompanyRepository companyRepository, PositionRepository positionRepository) {
        this.companyRepository = companyRepository;
        this.positionRepository = positionRepository;
    }

    @Transactional(readOnly = true)
    public List<CompanyDtos.Response> list(UUID userId, String keyword) {
        List<Company> companies = (keyword == null || keyword.isBlank())
            ? companyRepository.findByUserIdAndDeletedAtIsNullOrderByUpdatedAtDesc(userId)
            : companyRepository.search(userId, keyword.trim());
        return companies.stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public CompanyDtos.Response get(UUID userId, UUID companyId) {
        return toResponse(requireCompany(userId, companyId));
    }

    @Transactional
    public CompanyDtos.Response create(UUID userId, CompanyDtos.Request request) {
        Company company = new Company();
        company.setUserId(userId);
        apply(company, request);
        companyRepository.save(company);
        return toResponse(company);
    }

    @Transactional
    public CompanyDtos.Response update(UUID userId, UUID companyId, CompanyDtos.Request request) {
        Company company = requireCompany(userId, companyId);
        apply(company, request);
        return toResponse(company);
    }

    @Transactional
    public void delete(UUID userId, UUID companyId) {
        Company company = requireCompany(userId, companyId);
        Instant now = Instant.now();
        company.setDeletedAt(now);
        positionRepository.softDeleteByCompanyId(companyId, now);
    }

    private void apply(Company company, CompanyDtos.Request request) {
        company.setName(request.name().trim());
        company.setLocation(request.location() == null ? "" : request.location().trim());
        company.setCompanyType(request.companyType() == null ? "" : request.companyType());
        company.setNote(request.note() == null ? "" : request.note().trim());
    }

    public Company requireCompany(UUID userId, UUID companyId) {
        return companyRepository.findByIdAndUserIdAndDeletedAtIsNull(companyId, userId)
            .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "COMPANY_NOT_FOUND", "公司不存在"));
    }

    private CompanyDtos.Response toResponse(Company company) {
        List<PositionDtos.Response> positions = positionRepository
            .findByCompanyIdAndUserIdAndDeletedAtIsNullOrderByUpdatedAtDesc(company.getId(), company.getUserId())
            .stream()
            .map(PositionDtos.Response::from)
            .toList();
        return CompanyDtos.Response.from(company, positions);
    }
}
