package com.chi.jobtracker.position;

import com.chi.jobtracker.common.ApiException;
import com.chi.jobtracker.company.CompanyRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PositionService {

    private final PositionRepository positionRepository;
    private final CompanyRepository companyRepository;

    public PositionService(PositionRepository positionRepository, CompanyRepository companyRepository) {
        this.positionRepository = positionRepository;
        this.companyRepository = companyRepository;
    }

    @Transactional(readOnly = true)
    public List<PositionDtos.Response> list(UUID userId, UUID companyId) {
        requireCompany(userId, companyId);
        return positionRepository
            .findByCompanyIdAndUserIdAndDeletedAtIsNullOrderByUpdatedAtDesc(companyId, userId)
            .stream()
            .map(PositionDtos.Response::from)
            .toList();
    }

    @Transactional
    public PositionDtos.Response create(UUID userId, UUID companyId, PositionDtos.Request request) {
        requireCompany(userId, companyId);
        Position position = new Position();
        position.setCompanyId(companyId);
        position.setUserId(userId);
        apply(position, request);
        positionRepository.save(position);
        return PositionDtos.Response.from(position);
    }

    @Transactional
    public PositionDtos.Response update(UUID userId, UUID positionId, PositionDtos.Request request) {
        Position position = requirePosition(userId, positionId);
        apply(position, request);
        return PositionDtos.Response.from(position);
    }

    @Transactional
    public void delete(UUID userId, UUID positionId) {
        Position position = requirePosition(userId, positionId);
        position.setDeletedAt(Instant.now());
    }

    public Position requirePosition(UUID userId, UUID positionId) {
        return positionRepository.findByIdAndUserIdAndDeletedAtIsNull(positionId, userId)
            .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "POSITION_NOT_FOUND", "岗位不存在"));
    }

    private void requireCompany(UUID userId, UUID companyId) {
        companyRepository.findByIdAndUserIdAndDeletedAtIsNull(companyId, userId)
            .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "COMPANY_NOT_FOUND", "公司不存在"));
    }

    private void apply(Position position, PositionDtos.Request request) {
        position.setTitle(request.title().trim());
        position.setSalary(request.salary() == null ? "" : request.salary().trim());
        position.setChannel(request.channel() == null ? "" : request.channel().trim());
        position.setAppliedOn(request.appliedOn());
        position.setStatus(request.status() == null ? "pending" : request.status());
        position.setNote(request.note() == null ? "" : request.note().trim());
        position.setInterviewPrep(request.interviewPrep() == null ? "" : request.interviewPrep().trim());
        position.setExperienceSummary(
            request.experienceSummary() == null ? "" : request.experienceSummary().trim());
    }
}
