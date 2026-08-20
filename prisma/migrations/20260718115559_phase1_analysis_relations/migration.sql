-- AddForeignKey
ALTER TABLE "AnalysisRecommendation" ADD CONSTRAINT "AnalysisRecommendation_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "AnalysisArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRecommendation" ADD CONSTRAINT "AnalysisRecommendation_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
